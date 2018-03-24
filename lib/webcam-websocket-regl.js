const ffmpeg = require("./ffmpeg")
const { Readable } = require("stream")
const WebSocket = require("ws")
//var jpg = require("jpeg-turbo")
var fs = require("fs")
var libjpeg = require("libjpeg")
/*const libjpeg = require("libjpeg")
const jpeg = require("jpeg-js")*/
var toBuffer = require("typedarray-to-buffer")
var address = "ws://10.0.0.128/ws"

const W = 352
const H = 288

var GL

module.exports = () => {
  const window = {}
  let isBigScreen
  /*  const Canvas = require("canvas"),
    Image = Canvas.Image,
    canvas = new Canvas(640, 480),
    ctx = canvas.getContext("2d")

  console.log(Canvas.ImageData)*/

  /*  function startStream(options) {
    let maxrate = options.maxrate || 400
    FFMPEG = ffmpeg({
      format: "mpegts",
      w:options.w,
      h:options.h,
      output: `udp://${options.ip}:${options.port}`,
      options: [
        ` -preset ultrafast -tune zerolatency  -b:v ${maxrate /
          2}k -maxrate ${maxrate}k -bufsize ${maxrate}k  `,
      ],
    })
  }
*/
  ;(function() {
    const SAMPLE_RATES = new Int32Array([
      96000,
      88200,
      64000,
      48000,
      44100,
      32000,
      24000,
      22050,
      16000,
      12000,
      11025,
      8000,
      7350,
    ])

    var CCEElement = (function() {
      // Channel Coupling Element
      function CCEElement(config) {
        this.ics = new ICStream(config)
        this.channelPair = new Array(8)
        this.idSelect = new Int32Array(8)
        this.chSelect = new Int32Array(8)
        this.gain = new Array(16)
      }

      CCEElement.BEFORE_TNS = 0
      CCEElement.AFTER_TNS = 1
      CCEElement.AFTER_IMDCT = 2

      const CCE_SCALE = new Float32Array([
        1.09050773266525765921,
        1.18920711500272106672,
        1.4142135623730950488016887,
        2.0,
      ])

      CCEElement.prototype = {
        decode: function(stream, config) {
          var channelPair = this.channelPair,
            idSelect = this.idSelect,
            chSelect = this.chSelect

          this.couplingPoint = 2 * stream.read(1)
          this.coupledCount = stream.read(3)

          var gainCount = 0
          for (var i = 0; i <= this.coupledCount; i++) {
            gainCount++
            channelPair[i] = stream.read(1)
            idSelect[i] = stream.read(4)

            if (channelPair[i]) {
              chSelect[i] = stream.read(2)
              if (chSelect[i] === 3) gainCount++
            } else {
              chSelect[i] = 2
            }
          }

          this.couplingPoint += stream.read(1)
          this.couplingPoint |= this.couplingPoint >>> 1

          var sign = stream.read(1),
            scale = CCE_SCALE[stream.read(2)]

          this.ics.decode(stream, config, false)

          var groupCount = this.ics.info.groupCount,
            maxSFB = this.ics.info.maxSFB,
            bandTypes = this.ics.bandTypes

          for (var i = 0; i < gainCount; i++) {
            var idx = 0,
              cge = 1,
              gain = 0,
              gainCache = 1

            if (i > 0) {
              cge =
                this.couplingPoint === CCEElement.AFTER_IMDCT
                  ? 1
                  : stream.read(1)
              gain = cge ? Huffman.decodeScaleFactor(stream) - 60 : 0
              gainCache = Math.pow(scale, -gain)
            }

            var gain_i = (this.gain[i] = new Float32Array(120))

            if (this.couplingPoint === CCEElement.AFTER_IMDCT) {
              gain_i[0] = gainCache
            } else {
              for (var g = 0; g < groupCount; g++) {
                for (var sfb = 0; sfb < maxSFB; sfb++) {
                  if (bandTypes[idx] !== ICStream.ZERO_BT) {
                    if (cge === 0) {
                      var t = Huffman.decodeScaleFactor(stream) - 60
                      if (t !== 0) {
                        var s = 1
                        t = gain += t
                        if (sign) {
                          s -= 2 * (t * 0x1)
                          t >>>= 1
                        }
                        gainCache = Math.pow(scale, -t) * s
                      }
                    }
                    gain_i[idx++] = gainCache
                  }
                }
              }
            }
          }
        },

        applyIndependentCoupling: function(index, data) {
          var gain = this.gain[index][0],
            iqData = this.ics.data

          for (var i = 0; i < data.length; i++) {
            data[i] += gain * iqData[i]
          }
        },

        applyDependentCoupling: function(index, data) {
          var info = this.ics.info,
            swbOffsets = info.swbOffsets,
            groupCount = info.groupCount,
            maxSFB = info.maxSFB,
            bandTypes = this.ics.bandTypes,
            iqData = this.ics.data

          var idx = 0,
            offset = 0,
            gains = this.gain[index]

          for (var g = 0; g < groupCount; g++) {
            var len = info.groupLength[g]

            for (var sfb = 0; sfb < maxSFB; sfb++, idx++) {
              if (bandTypes[idx] !== ICStream.ZERO_BT) {
                var gain = gains[idx]
                for (var group = 0; group < len; group++) {
                  for (
                    var k = swbOffsets[sfb];
                    k < swbOffsets[swb + 1];
                    k++
                  ) {
                    data[offset + group * 128 + k] +=
                      gain * iqData[offset + group * 128 + k]
                  }
                }
              }
            }

            offset += len * 128
          }
        },
      }

      return CCEElement
    })()

    var CPEElement = (function() {
      // Channel Pair Element
      function CPEElement(config) {
        this.ms_used = []
        this.left = new ICStream(config)
        this.right = new ICStream(config)
      }

      const MAX_MS_MASK = 128

      const MASK_TYPE_ALL_0 = 0,
        MASK_TYPE_USED = 1,
        MASK_TYPE_ALL_1 = 2,
        MASK_TYPE_RESERVED = 3

      CPEElement.prototype.decode = function(stream, config) {
        var left = this.left,
          right = this.right,
          ms_used = this.ms_used

        if ((this.commonWindow = !!stream.read(1))) {
          left.info.decode(stream, config, true)
          right.info = left.info

          var mask = stream.read(2)
          this.maskPresent = !!mask

          switch (mask) {
            case MASK_TYPE_USED:
              var len = left.info.groupCount * left.info.maxSFB
              for (var i = 0; i < len; i++) {
                ms_used[i] = !!stream.read(1)
              }
              break

            case MASK_TYPE_ALL_0:
            case MASK_TYPE_ALL_1:
              var val = !!mask
              for (var i = 0; i < MAX_MS_MASK; i++) {
                ms_used[i] = val
              }
              break

            default:
              throw new Error("Reserved ms mask type: " + mask)
          }
        } else {
          for (var i = 0; i < MAX_MS_MASK; i++) ms_used[i] = false
        }

        left.decode(stream, config, this.commonWindow)
        right.decode(stream, config, this.commonWindow)
      }

      return CPEElement
    })()

    var FFT = (function() {
      function FFT(length) {
        this.length = length

        switch (length) {
          case 64:
            this.roots = generateFFTTableShort(64)
            break

          case 512:
            this.roots = generateFFTTableLong(512)
            break

          case 60:
            this.roots = generateFFTTableShort(60)
            break

          case 480:
            this.roots = generateFFTTableLong(480)
            break

          default:
            throw new Error("unexpected FFT length: " + length)
        }

        // processing buffers
        this.rev = new Array(length)
        for (var i = 0; i < length; i++) {
          this.rev[i] = new Float32Array(2)
        }

        this.a = new Float32Array(2)
        this.b = new Float32Array(2)
        this.c = new Float32Array(2)
        this.d = new Float32Array(2)
        this.e1 = new Float32Array(2)
        this.e2 = new Float32Array(2)
      }

      function generateFFTTableShort(len) {
        var t = 2 * Math.PI / len,
          cosT = Math.cos(t),
          sinT = Math.sin(t),
          f = new Array(len)

        for (var i = 0; i < len; i++) {
          f[i] = new Float32Array(2)
        }

        f[0][0] = 1
        f[0][1] = 0
        var lastImag = 0

        for (var i = 1; i < len; i++) {
          f[i][0] = f[i - 1][0] * cosT + lastImag * sinT
          lastImag = lastImag * cosT - f[i - 1][0] * sinT
          f[i][1] = -lastImag
        }

        return f
      }

      function generateFFTTableLong(len) {
        var t = 2 * Math.PI / len,
          cosT = Math.cos(t),
          sinT = Math.sin(t),
          f = new Array(len)

        for (var i = 0; i < len; i++) {
          f[i] = new Float32Array(3)
        }

        f[0][0] = 1
        f[0][1] = 0
        f[0][2] = 0

        for (var i = 1; i < len; i++) {
          f[i][0] = f[i - 1][0] * cosT + f[i - 1][2] * sinT
          f[i][2] = f[i - 1][2] * cosT - f[i - 1][0] * sinT
          f[i][1] = -f[i][2]
        }

        return f
      }

      FFT.prototype.process = function(input, forward) {
        var length = this.length,
          imOffset = forward ? 2 : 1,
          scale = forward ? length : 1,
          rev = this.rev,
          roots = this.roots

        // bit-reversal
        var ii = 0
        for (var i = 0; i < length; i++) {
          rev[i][0] = input[ii][0]
          rev[i][1] = input[ii][1]

          var k = length >>> 1
          while (ii >= k && k > 0) {
            ii -= k
            k >>= 1
          }

          ii += k
        }

        var a = this.a,
          b = this.b,
          c = this.c,
          d = this.d,
          e1 = this.e1,
          e2 = this.e2

        for (var i = 0; i < length; i++) {
          input[i][0] = rev[i][0]
          input[i][1] = rev[i][1]
        }

        // bottom base-4 round
        for (var i = 0; i < length; i += 4) {
          a[0] = input[i][0] + input[i + 1][0]
          a[1] = input[i][1] + input[i + 1][1]
          b[0] = input[i + 2][0] + input[i + 3][0]
          b[1] = input[i + 2][1] + input[i + 3][1]
          c[0] = input[i][0] - input[i + 1][0]
          c[1] = input[i][1] - input[i + 1][1]
          d[0] = input[i + 2][0] - input[i + 3][0]
          d[1] = input[i + 2][1] - input[i + 3][1]
          input[i][0] = a[0] + b[0]
          input[i][1] = a[1] + b[1]
          input[i + 2][0] = a[0] - b[0]
          input[i + 2][1] = a[1] - b[1]

          e1[0] = c[0] - d[1]
          e1[1] = c[1] + d[0]
          e2[0] = c[0] + d[1]
          e2[1] = c[1] - d[0]

          if (forward) {
            input[i + 1][0] = e2[0]
            input[i + 1][1] = e2[1]
            input[i + 3][0] = e1[0]
            input[i + 3][1] = e1[1]
          } else {
            input[i + 1][0] = e1[0]
            input[i + 1][1] = e1[1]
            input[i + 3][0] = e2[0]
            input[i + 3][1] = e2[1]
          }
        }

        // iterations from bottom to top
        for (var i = 4; i < length; i <<= 1) {
          var shift = i << 1,
            m = length / shift

          for (var j = 0; j < length; j += shift) {
            for (var k = 0; k < i; k++) {
              var km = k * m,
                rootRe = roots[km][0],
                rootIm = roots[km][imOffset],
                zRe =
                  input[i + j + k][0] * rootRe -
                  input[i + j + k][1] * rootIm,
                zIm =
                  input[i + j + k][0] * rootIm +
                  input[i + j + k][1] * rootRe

              input[i + j + k][0] = (input[j + k][0] - zRe) * scale
              input[i + j + k][1] = (input[j + k][1] - zIm) * scale
              input[j + k][0] = (input[j + k][0] + zRe) * scale
              input[j + k][1] = (input[j + k][1] + zIm) * scale
            }
          }
        }
      }

      return FFT
    })()

    var FilterBank = (function() {
      function FilterBank(smallFrames, channels) {
        if (smallFrames) {
          throw new Error("WHA?? No small frames allowed.")
        }

        this.length = 1024
        this.shortLength = 128

        this.mid = (this.length - this.shortLength) / 2
        this.trans = this.shortLength / 2

        this.mdctShort = new MDCT(this.shortLength * 2)
        this.mdctLong = new MDCT(this.length * 2)

        this.overlaps = new Array(channels)
        for (var i = 0; i < channels; i++) {
          this.overlaps[i] = new Float32Array(this.length)
        }

        this.buf = new Float32Array(2 * this.length)
      }

      function generateSineWindow(len) {
        var d = new Float32Array(len)
        for (var i = 0; i < len; i++) {
          d[i] = Math.sin((i + 0.5) * (Math.PI / (2.0 * len)))
        }
        return d
      }

      function generateKBDWindow(alpha, len) {
        var PIN = Math.PI / len,
          out = new Float32Array(len),
          sum = 0,
          f = new Float32Array(len),
          alpha2 = alpha * PIN * (alpha * PIN)

        for (var n = 0; n < len; n++) {
          var tmp = n * (len - n) * alpha2,
            bessel = 1

          for (var j = 50; j > 0; j--) {
            bessel = bessel * tmp / (j * j) + 1
          }

          sum += bessel
          f[n] = sum
        }

        sum++
        for (var n = 0; n < len; n++) {
          out[n] = Math.sqrt(f[n] / sum)
        }

        return out
      }

      const SINE_1024 = generateSineWindow(1024),
        SINE_128 = generateSineWindow(128),
        KBD_1024 = generateKBDWindow(4, 1024),
        KBD_128 = generateKBDWindow(6, 128),
        LONG_WINDOWS = [SINE_1024, KBD_1024],
        SHORT_WINDOWS = [SINE_128, KBD_128]

      FilterBank.prototype.process = function(
        info,
        input,
        output,
        channel
      ) {
        var overlap = this.overlaps[channel],
          windowShape = info.windowShape[1],
          windowShapePrev = info.windowShape[0],
          longWindows = LONG_WINDOWS[windowShape],
          shortWindows = SHORT_WINDOWS[windowShape],
          longWindowsPrev = LONG_WINDOWS[windowShapePrev],
          shortWindowsPrev = SHORT_WINDOWS[windowShapePrev],
          length = this.length,
          shortLen = this.shortLength,
          mid = this.mid,
          trans = this.trans,
          buf = this.buf,
          mdctLong = this.mdctLong,
          mdctShort = this.mdctShort

        switch (info.windowSequence) {
          case ICStream.ONLY_LONG_SEQUENCE:
            mdctLong.process(input, 0, buf, 0)

            // add second half output of previous frame to windowed output of current frame
            for (var i = 0; i < length; i++) {
              output[i] = overlap[i] + buf[i] * longWindowsPrev[i]
            }

            // window the second half and save as overlap for next frame
            for (var i = 0; i < length; i++) {
              overlap[i] =
                buf[length + i] * longWindows[length - 1 - i]
            }

            break

          case ICStream.LONG_START_SEQUENCE:
            mdctLong.process(input, 0, buf, 0)

            // add second half output of previous frame to windowed output of current frame
            for (var i = 0; i < length; i++) {
              output[i] = overlap[i] + buf[i] * longWindowsPrev[i]
            }

            // window the second half and save as overlap for next frame
            for (var i = 0; i < mid; i++) {
              overlap[i] = buf[length + i]
            }

            for (var i = 0; i < shortLen; i++) {
              overlap[mid + i] =
                buf[length + mid + i] * shortWindows[shortLen - i - 1]
            }

            for (var i = 0; i < mid; i++) {
              overlap[mid + shortLen + i] = 0
            }

            break

          case ICStream.EIGHT_SHORT_SEQUENCE:
            for (var i = 0; i < 8; i++) {
              mdctShort.process(
                input,
                i * shortLen,
                buf,
                2 * i * shortLen
              )
            }

            // add second half output of previous frame to windowed output of current frame
            for (var i = 0; i < mid; i++) {
              output[i] = overlap[i]
            }

            for (var i = 0; i < shortLen; i++) {
              output[mid + i] =
                overlap[mid + i] + buf[i] * shortWindowsPrev[i]
              output[mid + 1 * shortLen + i] =
                overlap[mid + shortLen * 1 + i] +
                buf[shortLen * 1 + i] *
                  shortWindows[shortLen - 1 - i] +
                buf[shortLen * 2 + i] * shortWindows[i]
              output[mid + 2 * shortLen + i] =
                overlap[mid + shortLen * 2 + i] +
                buf[shortLen * 3 + i] *
                  shortWindows[shortLen - 1 - i] +
                buf[shortLen * 4 + i] * shortWindows[i]
              output[mid + 3 * shortLen + i] =
                overlap[mid + shortLen * 3 + i] +
                buf[shortLen * 5 + i] *
                  shortWindows[shortLen - 1 - i] +
                buf[shortLen * 6 + i] * shortWindows[i]

              if (i < trans)
                output[mid + 4 * shortLen + i] =
                  overlap[mid + shortLen * 4 + i] +
                  buf[shortLen * 7 + i] *
                    shortWindows[shortLen - 1 - i] +
                  buf[shortLen * 8 + i] * shortWindows[i]
            }

            // window the second half and save as overlap for next frame
            for (var i = 0; i < shortLen; i++) {
              if (i >= trans)
                overlap[mid + 4 * shortLen + i - length] =
                  buf[shortLen * 7 + i] *
                    shortWindows[shortLen - 1 - i] +
                  buf[shortLen * 8 + i] * shortWindows[i]

              overlap[mid + 5 * shortLen + i - length] =
                buf[shortLen * 9 + i] *
                  shortWindows[shortLen - 1 - i] +
                buf[shortLen * 10 + i] * shortWindows[i]
              overlap[mid + 6 * shortLen + i - length] =
                buf[shortLen * 11 + i] *
                  shortWindows[shortLen - 1 - i] +
                buf[shortLen * 12 + i] * shortWindows[i]
              overlap[mid + 7 * shortLen + i - length] =
                buf[shortLen * 13 + i] *
                  shortWindows[shortLen - 1 - i] +
                buf[shortLen * 14 + i] * shortWindows[i]
              overlap[mid + 8 * shortLen + i - length] =
                buf[shortLen * 15 + i] *
                shortWindows[shortLen - 1 - i]
            }

            for (var i = 0; i < mid; i++) {
              overlap[mid + shortLen + i] = 0
            }

            break

          case ICStream.LONG_STOP_SEQUENCE:
            mdctLong.process(input, 0, buf, 0)

            // add second half output of previous frame to windowed output of current frame
            // construct first half window using padding with 1's and 0's
            for (var i = 0; i < mid; i++) {
              output[i] = overlap[i]
            }

            for (var i = 0; i < shortLen; i++) {
              output[mid + i] =
                overlap[mid + i] + buf[mid + i] * shortWindowsPrev[i]
            }

            for (var i = 0; i < mid; i++) {
              output[mid + shortLen + i] =
                overlap[mid + shortLen + i] + buf[mid + shortLen + i]
            }

            // window the second half and save as overlap for next frame
            for (var i = 0; i < length; i++) {
              overlap[i] =
                buf[length + i] * longWindows[length - 1 - i]
            }

            break
        }
      }

      return FilterBank
    })()

    var Huffman = (function() {
      // [bit length, codeword, values...]
      const HCB1 = [
        [1, 0, 0, 0, 0, 0],
        [5, 16, 1, 0, 0, 0],
        [5, 17, -1, 0, 0, 0],
        [5, 18, 0, 0, 0, -1],
        [5, 19, 0, 1, 0, 0],
        [5, 20, 0, 0, 0, 1],
        [5, 21, 0, 0, -1, 0],
        [5, 22, 0, 0, 1, 0],
        [5, 23, 0, -1, 0, 0],
        [7, 96, 1, -1, 0, 0],
        [7, 97, -1, 1, 0, 0],
        [7, 98, 0, 0, -1, 1],
        [7, 99, 0, 1, -1, 0],
        [7, 100, 0, -1, 1, 0],
        [7, 101, 0, 0, 1, -1],
        [7, 102, 1, 1, 0, 0],
        [7, 103, 0, 0, -1, -1],
        [7, 104, -1, -1, 0, 0],
        [7, 105, 0, -1, -1, 0],
        [7, 106, 1, 0, -1, 0],
        [7, 107, 0, 1, 0, -1],
        [7, 108, -1, 0, 1, 0],
        [7, 109, 0, 0, 1, 1],
        [7, 110, 1, 0, 1, 0],
        [7, 111, 0, -1, 0, 1],
        [7, 112, 0, 1, 1, 0],
        [7, 113, 0, 1, 0, 1],
        [7, 114, -1, 0, -1, 0],
        [7, 115, 1, 0, 0, 1],
        [7, 116, -1, 0, 0, -1],
        [7, 117, 1, 0, 0, -1],
        [7, 118, -1, 0, 0, 1],
        [7, 119, 0, -1, 0, -1],
        [9, 480, 1, 1, -1, 0],
        [9, 481, -1, 1, -1, 0],
        [9, 482, 1, -1, 1, 0],
        [9, 483, 0, 1, 1, -1],
        [9, 484, 0, 1, -1, 1],
        [9, 485, 0, -1, 1, 1],
        [9, 486, 0, -1, 1, -1],
        [9, 487, 1, -1, -1, 0],
        [9, 488, 1, 0, -1, 1],
        [9, 489, 0, 1, -1, -1],
        [9, 490, -1, 1, 1, 0],
        [9, 491, -1, 0, 1, -1],
        [9, 492, -1, -1, 1, 0],
        [9, 493, 0, -1, -1, 1],
        [9, 494, 1, -1, 0, 1],
        [9, 495, 1, -1, 0, -1],
        [9, 496, -1, 1, 0, -1],
        [9, 497, -1, -1, -1, 0],
        [9, 498, 0, -1, -1, -1],
        [9, 499, 0, 1, 1, 1],
        [9, 500, 1, 0, 1, -1],
        [9, 501, 1, 1, 0, 1],
        [9, 502, -1, 1, 0, 1],
        [9, 503, 1, 1, 1, 0],
        [10, 1008, -1, -1, 0, 1],
        [10, 1009, -1, 0, -1, -1],
        [10, 1010, 1, 1, 0, -1],
        [10, 1011, 1, 0, -1, -1],
        [10, 1012, -1, 0, -1, 1],
        [10, 1013, -1, -1, 0, -1],
        [10, 1014, -1, 0, 1, 1],
        [10, 1015, 1, 0, 1, 1],
        [11, 2032, 1, -1, 1, -1],
        [11, 2033, -1, 1, -1, 1],
        [11, 2034, -1, 1, 1, -1],
        [11, 2035, 1, -1, -1, 1],
        [11, 2036, 1, 1, 1, 1],
        [11, 2037, -1, -1, 1, 1],
        [11, 2038, 1, 1, -1, -1],
        [11, 2039, -1, -1, 1, -1],
        [11, 2040, -1, -1, -1, -1],
        [11, 2041, 1, 1, -1, 1],
        [11, 2042, 1, -1, 1, 1],
        [11, 2043, -1, 1, 1, 1],
        [11, 2044, -1, 1, -1, -1],
        [11, 2045, -1, -1, -1, 1],
        [11, 2046, 1, -1, -1, -1],
        [11, 2047, 1, 1, 1, -1],
      ]

      const HCB2 = [
        [3, 0, 0, 0, 0, 0],
        [4, 2, 1, 0, 0, 0],
        [5, 6, -1, 0, 0, 0],
        [5, 7, 0, 0, 0, 1],
        [5, 8, 0, 0, -1, 0],
        [5, 9, 0, 0, 0, -1],
        [5, 10, 0, -1, 0, 0],
        [5, 11, 0, 0, 1, 0],
        [5, 12, 0, 1, 0, 0],
        [6, 26, 0, -1, 1, 0],
        [6, 27, -1, 1, 0, 0],
        [6, 28, 0, 1, -1, 0],
        [6, 29, 0, 0, 1, -1],
        [6, 30, 0, 1, 0, -1],
        [6, 31, 0, 0, -1, 1],
        [6, 32, -1, 0, 0, -1],
        [6, 33, 1, -1, 0, 0],
        [6, 34, 1, 0, -1, 0],
        [6, 35, -1, -1, 0, 0],
        [6, 36, 0, 0, -1, -1],
        [6, 37, 1, 0, 1, 0],
        [6, 38, 1, 0, 0, 1],
        [6, 39, 0, -1, 0, 1],
        [6, 40, -1, 0, 1, 0],
        [6, 41, 0, 1, 0, 1],
        [6, 42, 0, -1, -1, 0],
        [6, 43, -1, 0, 0, 1],
        [6, 44, 0, -1, 0, -1],
        [6, 45, -1, 0, -1, 0],
        [6, 46, 1, 1, 0, 0],
        [6, 47, 0, 1, 1, 0],
        [6, 48, 0, 0, 1, 1],
        [6, 49, 1, 0, 0, -1],
        [7, 100, 0, 1, -1, 1],
        [7, 101, 1, 0, -1, 1],
        [7, 102, -1, 1, -1, 0],
        [7, 103, 0, -1, 1, -1],
        [7, 104, 1, -1, 1, 0],
        [7, 105, 1, 1, 0, -1],
        [7, 106, 1, 0, 1, 1],
        [7, 107, -1, 1, 1, 0],
        [7, 108, 0, -1, -1, 1],
        [7, 109, 1, 1, 1, 0],
        [7, 110, -1, 0, 1, -1],
        [7, 111, -1, -1, -1, 0],
        [7, 112, -1, 0, -1, 1],
        [7, 113, 1, -1, -1, 0],
        [7, 114, 1, 1, -1, 0],
        [8, 230, 1, -1, 0, 1],
        [8, 231, -1, 1, 0, -1],
        [8, 232, -1, -1, 1, 0],
        [8, 233, -1, 0, 1, 1],
        [8, 234, -1, -1, 0, 1],
        [8, 235, -1, -1, 0, -1],
        [8, 236, 0, -1, -1, -1],
        [8, 237, 1, 0, 1, -1],
        [8, 238, 1, 0, -1, -1],
        [8, 239, 0, 1, -1, -1],
        [8, 240, 0, 1, 1, 1],
        [8, 241, -1, 1, 0, 1],
        [8, 242, -1, 0, -1, -1],
        [8, 243, 0, 1, 1, -1],
        [8, 244, 1, -1, 0, -1],
        [8, 245, 0, -1, 1, 1],
        [8, 246, 1, 1, 0, 1],
        [8, 247, 1, -1, 1, -1],
        [8, 248, -1, 1, -1, 1],
        [9, 498, 1, -1, -1, 1],
        [9, 499, -1, -1, -1, -1],
        [9, 500, -1, 1, 1, -1],
        [9, 501, -1, 1, 1, 1],
        [9, 502, 1, 1, 1, 1],
        [9, 503, -1, -1, 1, -1],
        [9, 504, 1, -1, 1, 1],
        [9, 505, -1, 1, -1, -1],
        [9, 506, -1, -1, 1, 1],
        [9, 507, 1, 1, -1, -1],
        [9, 508, 1, -1, -1, -1],
        [9, 509, -1, -1, -1, 1],
        [9, 510, 1, 1, -1, 1],
        [9, 511, 1, 1, 1, -1],
      ]

      const HCB3 = [
        [1, 0, 0, 0, 0, 0],
        [4, 8, 1, 0, 0, 0],
        [4, 9, 0, 0, 0, 1],
        [4, 10, 0, 1, 0, 0],
        [4, 11, 0, 0, 1, 0],
        [5, 24, 1, 1, 0, 0],
        [5, 25, 0, 0, 1, 1],
        [6, 52, 0, 1, 1, 0],
        [6, 53, 0, 1, 0, 1],
        [6, 54, 1, 0, 1, 0],
        [6, 55, 0, 1, 1, 1],
        [6, 56, 1, 0, 0, 1],
        [6, 57, 1, 1, 1, 0],
        [7, 116, 1, 1, 1, 1],
        [7, 117, 1, 0, 1, 1],
        [7, 118, 1, 1, 0, 1],
        [8, 238, 2, 0, 0, 0],
        [8, 239, 0, 0, 0, 2],
        [8, 240, 0, 0, 1, 2],
        [8, 241, 2, 1, 0, 0],
        [8, 242, 1, 2, 1, 0],
        [9, 486, 0, 0, 2, 1],
        [9, 487, 0, 1, 2, 1],
        [9, 488, 1, 2, 0, 0],
        [9, 489, 0, 1, 1, 2],
        [9, 490, 2, 1, 1, 0],
        [9, 491, 0, 0, 2, 0],
        [9, 492, 0, 2, 1, 0],
        [9, 493, 0, 1, 2, 0],
        [9, 494, 0, 2, 0, 0],
        [9, 495, 0, 1, 0, 2],
        [9, 496, 2, 0, 1, 0],
        [9, 497, 1, 2, 1, 1],
        [9, 498, 0, 2, 1, 1],
        [9, 499, 1, 1, 2, 0],
        [9, 500, 1, 1, 2, 1],
        [10, 1002, 1, 2, 0, 1],
        [10, 1003, 1, 0, 2, 0],
        [10, 1004, 1, 0, 2, 1],
        [10, 1005, 0, 2, 0, 1],
        [10, 1006, 2, 1, 1, 1],
        [10, 1007, 1, 1, 1, 2],
        [10, 1008, 2, 1, 0, 1],
        [10, 1009, 1, 0, 1, 2],
        [10, 1010, 0, 0, 2, 2],
        [10, 1011, 0, 1, 2, 2],
        [10, 1012, 2, 2, 1, 0],
        [10, 1013, 1, 2, 2, 0],
        [10, 1014, 1, 0, 0, 2],
        [10, 1015, 2, 0, 0, 1],
        [10, 1016, 0, 2, 2, 1],
        [11, 2034, 2, 2, 0, 0],
        [11, 2035, 1, 2, 2, 1],
        [11, 2036, 1, 1, 0, 2],
        [11, 2037, 2, 0, 1, 1],
        [11, 2038, 1, 1, 2, 2],
        [11, 2039, 2, 2, 1, 1],
        [11, 2040, 0, 2, 2, 0],
        [11, 2041, 0, 2, 1, 2],
        [12, 4084, 1, 0, 2, 2],
        [12, 4085, 2, 2, 0, 1],
        [12, 4086, 2, 1, 2, 0],
        [12, 4087, 2, 2, 2, 0],
        [12, 4088, 0, 2, 2, 2],
        [12, 4089, 2, 2, 2, 1],
        [12, 4090, 2, 1, 2, 1],
        [12, 4091, 1, 2, 1, 2],
        [12, 4092, 1, 2, 2, 2],
        [13, 8186, 0, 2, 0, 2],
        [13, 8187, 2, 0, 2, 0],
        [13, 8188, 1, 2, 0, 2],
        [14, 16378, 2, 0, 2, 1],
        [14, 16379, 2, 1, 1, 2],
        [14, 16380, 2, 1, 0, 2],
        [15, 32762, 2, 2, 2, 2],
        [15, 32763, 2, 2, 1, 2],
        [15, 32764, 2, 1, 2, 2],
        [15, 32765, 2, 0, 1, 2],
        [15, 32766, 2, 0, 0, 2],
        [16, 65534, 2, 2, 0, 2],
        [16, 65535, 2, 0, 2, 2],
      ]

      const HCB4 = [
        [4, 0, 1, 1, 1, 1],
        [4, 1, 0, 1, 1, 1],
        [4, 2, 1, 1, 0, 1],
        [4, 3, 1, 1, 1, 0],
        [4, 4, 1, 0, 1, 1],
        [4, 5, 1, 0, 0, 0],
        [4, 6, 1, 1, 0, 0],
        [4, 7, 0, 0, 0, 0],
        [4, 8, 0, 0, 1, 1],
        [4, 9, 1, 0, 1, 0],
        [5, 20, 1, 0, 0, 1],
        [5, 21, 0, 1, 1, 0],
        [5, 22, 0, 0, 0, 1],
        [5, 23, 0, 1, 0, 1],
        [5, 24, 0, 0, 1, 0],
        [5, 25, 0, 1, 0, 0],
        [7, 104, 2, 1, 1, 1],
        [7, 105, 1, 1, 2, 1],
        [7, 106, 1, 2, 1, 1],
        [7, 107, 1, 1, 1, 2],
        [7, 108, 2, 1, 1, 0],
        [7, 109, 2, 1, 0, 1],
        [7, 110, 1, 2, 1, 0],
        [7, 111, 2, 0, 1, 1],
        [7, 112, 0, 1, 2, 1],
        [8, 226, 0, 1, 1, 2],
        [8, 227, 1, 1, 2, 0],
        [8, 228, 0, 2, 1, 1],
        [8, 229, 1, 0, 1, 2],
        [8, 230, 1, 2, 0, 1],
        [8, 231, 1, 1, 0, 2],
        [8, 232, 1, 0, 2, 1],
        [8, 233, 2, 1, 0, 0],
        [8, 234, 2, 0, 1, 0],
        [8, 235, 1, 2, 0, 0],
        [8, 236, 2, 0, 0, 1],
        [8, 237, 0, 1, 0, 2],
        [8, 238, 0, 2, 1, 0],
        [8, 239, 0, 0, 1, 2],
        [8, 240, 0, 1, 2, 0],
        [8, 241, 0, 2, 0, 1],
        [8, 242, 1, 0, 0, 2],
        [8, 243, 0, 0, 2, 1],
        [8, 244, 1, 0, 2, 0],
        [8, 245, 2, 0, 0, 0],
        [8, 246, 0, 0, 0, 2],
        [9, 494, 0, 2, 0, 0],
        [9, 495, 0, 0, 2, 0],
        [9, 496, 1, 2, 2, 1],
        [9, 497, 2, 2, 1, 1],
        [9, 498, 2, 1, 2, 1],
        [9, 499, 1, 1, 2, 2],
        [9, 500, 1, 2, 1, 2],
        [9, 501, 2, 1, 1, 2],
        [10, 1004, 1, 2, 2, 0],
        [10, 1005, 2, 2, 1, 0],
        [10, 1006, 2, 1, 2, 0],
        [10, 1007, 0, 2, 2, 1],
        [10, 1008, 0, 1, 2, 2],
        [10, 1009, 2, 2, 0, 1],
        [10, 1010, 0, 2, 1, 2],
        [10, 1011, 2, 0, 2, 1],
        [10, 1012, 1, 0, 2, 2],
        [10, 1013, 2, 2, 2, 1],
        [10, 1014, 1, 2, 0, 2],
        [10, 1015, 2, 0, 1, 2],
        [10, 1016, 2, 1, 0, 2],
        [10, 1017, 1, 2, 2, 2],
        [11, 2036, 2, 1, 2, 2],
        [11, 2037, 2, 2, 1, 2],
        [11, 2038, 0, 2, 2, 0],
        [11, 2039, 2, 2, 0, 0],
        [11, 2040, 0, 0, 2, 2],
        [11, 2041, 2, 0, 2, 0],
        [11, 2042, 0, 2, 0, 2],
        [11, 2043, 2, 0, 0, 2],
        [11, 2044, 2, 2, 2, 2],
        [11, 2045, 0, 2, 2, 2],
        [11, 2046, 2, 2, 2, 0],
        [12, 4094, 2, 2, 0, 2],
        [12, 4095, 2, 0, 2, 2],
      ]

      const HCB5 = [
        [1, 0, 0, 0],
        [4, 8, -1, 0],
        [4, 9, 1, 0],
        [4, 10, 0, 1],
        [4, 11, 0, -1],
        [5, 24, 1, -1],
        [5, 25, -1, 1],
        [5, 26, -1, -1],
        [5, 27, 1, 1],
        [7, 112, -2, 0],
        [7, 113, 0, 2],
        [7, 114, 2, 0],
        [7, 115, 0, -2],
        [8, 232, -2, -1],
        [8, 233, 2, 1],
        [8, 234, -1, -2],
        [8, 235, 1, 2],
        [8, 236, -2, 1],
        [8, 237, 2, -1],
        [8, 238, -1, 2],
        [8, 239, 1, -2],
        [8, 240, -3, 0],
        [8, 241, 3, 0],
        [8, 242, 0, -3],
        [8, 243, 0, 3],
        [9, 488, -3, -1],
        [9, 489, 1, 3],
        [9, 490, 3, 1],
        [9, 491, -1, -3],
        [9, 492, -3, 1],
        [9, 493, 3, -1],
        [9, 494, 1, -3],
        [9, 495, -1, 3],
        [9, 496, -2, 2],
        [9, 497, 2, 2],
        [9, 498, -2, -2],
        [9, 499, 2, -2],
        [10, 1000, -3, -2],
        [10, 1001, 3, -2],
        [10, 1002, -2, 3],
        [10, 1003, 2, -3],
        [10, 1004, 3, 2],
        [10, 1005, 2, 3],
        [10, 1006, -3, 2],
        [10, 1007, -2, -3],
        [10, 1008, 0, -4],
        [10, 1009, -4, 0],
        [10, 1010, 4, 1],
        [10, 1011, 4, 0],
        [11, 2024, -4, -1],
        [11, 2025, 0, 4],
        [11, 2026, 4, -1],
        [11, 2027, -1, -4],
        [11, 2028, 1, 4],
        [11, 2029, -1, 4],
        [11, 2030, -4, 1],
        [11, 2031, 1, -4],
        [11, 2032, 3, -3],
        [11, 2033, -3, -3],
        [11, 2034, -3, 3],
        [11, 2035, -2, 4],
        [11, 2036, -4, -2],
        [11, 2037, 4, 2],
        [11, 2038, 2, -4],
        [11, 2039, 2, 4],
        [11, 2040, 3, 3],
        [11, 2041, -4, 2],
        [12, 4084, -2, -4],
        [12, 4085, 4, -2],
        [12, 4086, 3, -4],
        [12, 4087, -4, -3],
        [12, 4088, -4, 3],
        [12, 4089, 3, 4],
        [12, 4090, -3, 4],
        [12, 4091, 4, 3],
        [12, 4092, 4, -3],
        [12, 4093, -3, -4],
        [13, 8188, 4, -4],
        [13, 8189, -4, 4],
        [13, 8190, 4, 4],
        [13, 8191, -4, -4],
      ]

      const HCB6 = [
        [4, 0, 0, 0],
        [4, 1, 1, 0],
        [4, 2, 0, -1],
        [4, 3, 0, 1],
        [4, 4, -1, 0],
        [4, 5, 1, 1],
        [4, 6, -1, 1],
        [4, 7, 1, -1],
        [4, 8, -1, -1],
        [6, 36, 2, -1],
        [6, 37, 2, 1],
        [6, 38, -2, 1],
        [6, 39, -2, -1],
        [6, 40, -2, 0],
        [6, 41, -1, 2],
        [6, 42, 2, 0],
        [6, 43, 1, -2],
        [6, 44, 1, 2],
        [6, 45, 0, -2],
        [6, 46, -1, -2],
        [6, 47, 0, 2],
        [6, 48, 2, -2],
        [6, 49, -2, 2],
        [6, 50, -2, -2],
        [6, 51, 2, 2],
        [7, 104, -3, 1],
        [7, 105, 3, 1],
        [7, 106, 3, -1],
        [7, 107, -1, 3],
        [7, 108, -3, -1],
        [7, 109, 1, 3],
        [7, 110, 1, -3],
        [7, 111, -1, -3],
        [7, 112, 3, 0],
        [7, 113, -3, 0],
        [7, 114, 0, -3],
        [7, 115, 0, 3],
        [7, 116, 3, 2],
        [8, 234, -3, -2],
        [8, 235, -2, 3],
        [8, 236, 2, 3],
        [8, 237, 3, -2],
        [8, 238, 2, -3],
        [8, 239, -2, -3],
        [8, 240, -3, 2],
        [8, 241, 3, 3],
        [9, 484, 3, -3],
        [9, 485, -3, -3],
        [9, 486, -3, 3],
        [9, 487, 1, -4],
        [9, 488, -1, -4],
        [9, 489, 4, 1],
        [9, 490, -4, 1],
        [9, 491, -4, -1],
        [9, 492, 1, 4],
        [9, 493, 4, -1],
        [9, 494, -1, 4],
        [9, 495, 0, -4],
        [9, 496, -4, 2],
        [9, 497, -4, -2],
        [9, 498, 2, 4],
        [9, 499, -2, -4],
        [9, 500, -4, 0],
        [9, 501, 4, 2],
        [9, 502, 4, -2],
        [9, 503, -2, 4],
        [9, 504, 4, 0],
        [9, 505, 2, -4],
        [9, 506, 0, 4],
        [10, 1014, -3, -4],
        [10, 1015, -3, 4],
        [10, 1016, 3, -4],
        [10, 1017, 4, -3],
        [10, 1018, 3, 4],
        [10, 1019, 4, 3],
        [10, 1020, -4, 3],
        [10, 1021, -4, -3],
        [11, 2044, 4, 4],
        [11, 2045, -4, 4],
        [11, 2046, -4, -4],
        [11, 2047, 4, -4],
      ]

      const HCB7 = [
        [1, 0, 0, 0],
        [3, 4, 1, 0],
        [3, 5, 0, 1],
        [4, 12, 1, 1],
        [6, 52, 2, 1],
        [6, 53, 1, 2],
        [6, 54, 2, 0],
        [6, 55, 0, 2],
        [7, 112, 3, 1],
        [7, 113, 1, 3],
        [7, 114, 2, 2],
        [7, 115, 3, 0],
        [7, 116, 0, 3],
        [8, 234, 2, 3],
        [8, 235, 3, 2],
        [8, 236, 1, 4],
        [8, 237, 4, 1],
        [8, 238, 1, 5],
        [8, 239, 5, 1],
        [8, 240, 3, 3],
        [8, 241, 2, 4],
        [8, 242, 0, 4],
        [8, 243, 4, 0],
        [9, 488, 4, 2],
        [9, 489, 2, 5],
        [9, 490, 5, 2],
        [9, 491, 0, 5],
        [9, 492, 6, 1],
        [9, 493, 5, 0],
        [9, 494, 1, 6],
        [9, 495, 4, 3],
        [9, 496, 3, 5],
        [9, 497, 3, 4],
        [9, 498, 5, 3],
        [9, 499, 2, 6],
        [9, 500, 6, 2],
        [9, 501, 1, 7],
        [10, 1004, 3, 6],
        [10, 1005, 0, 6],
        [10, 1006, 6, 0],
        [10, 1007, 4, 4],
        [10, 1008, 7, 1],
        [10, 1009, 4, 5],
        [10, 1010, 7, 2],
        [10, 1011, 5, 4],
        [10, 1012, 6, 3],
        [10, 1013, 2, 7],
        [10, 1014, 7, 3],
        [10, 1015, 6, 4],
        [10, 1016, 5, 5],
        [10, 1017, 4, 6],
        [10, 1018, 3, 7],
        [11, 2038, 7, 0],
        [11, 2039, 0, 7],
        [11, 2040, 6, 5],
        [11, 2041, 5, 6],
        [11, 2042, 7, 4],
        [11, 2043, 4, 7],
        [11, 2044, 5, 7],
        [11, 2045, 7, 5],
        [12, 4092, 7, 6],
        [12, 4093, 6, 6],
        [12, 4094, 6, 7],
        [12, 4095, 7, 7],
      ]

      const HCB8 = [
        [3, 0, 1, 1],
        [4, 2, 2, 1],
        [4, 3, 1, 0],
        [4, 4, 1, 2],
        [4, 5, 0, 1],
        [4, 6, 2, 2],
        [5, 14, 0, 0],
        [5, 15, 2, 0],
        [5, 16, 0, 2],
        [5, 17, 3, 1],
        [5, 18, 1, 3],
        [5, 19, 3, 2],
        [5, 20, 2, 3],
        [6, 42, 3, 3],
        [6, 43, 4, 1],
        [6, 44, 1, 4],
        [6, 45, 4, 2],
        [6, 46, 2, 4],
        [6, 47, 3, 0],
        [6, 48, 0, 3],
        [6, 49, 4, 3],
        [6, 50, 3, 4],
        [6, 51, 5, 2],
        [7, 104, 5, 1],
        [7, 105, 2, 5],
        [7, 106, 1, 5],
        [7, 107, 5, 3],
        [7, 108, 3, 5],
        [7, 109, 4, 4],
        [7, 110, 5, 4],
        [7, 111, 0, 4],
        [7, 112, 4, 5],
        [7, 113, 4, 0],
        [7, 114, 2, 6],
        [7, 115, 6, 2],
        [7, 116, 6, 1],
        [7, 117, 1, 6],
        [8, 236, 3, 6],
        [8, 237, 6, 3],
        [8, 238, 5, 5],
        [8, 239, 5, 0],
        [8, 240, 6, 4],
        [8, 241, 0, 5],
        [8, 242, 4, 6],
        [8, 243, 7, 1],
        [8, 244, 7, 2],
        [8, 245, 2, 7],
        [8, 246, 6, 5],
        [8, 247, 7, 3],
        [8, 248, 1, 7],
        [8, 249, 5, 6],
        [8, 250, 3, 7],
        [9, 502, 6, 6],
        [9, 503, 7, 4],
        [9, 504, 6, 0],
        [9, 505, 4, 7],
        [9, 506, 0, 6],
        [9, 507, 7, 5],
        [9, 508, 7, 6],
        [9, 509, 6, 7],
        [10, 1020, 5, 7],
        [10, 1021, 7, 0],
        [10, 1022, 0, 7],
        [10, 1023, 7, 7],
      ]

      const HCB9 = [
        [1, 0, 0, 0],
        [3, 4, 1, 0],
        [3, 5, 0, 1],
        [4, 12, 1, 1],
        [6, 52, 2, 1],
        [6, 53, 1, 2],
        [6, 54, 2, 0],
        [6, 55, 0, 2],
        [7, 112, 3, 1],
        [7, 113, 2, 2],
        [7, 114, 1, 3],
        [8, 230, 3, 0],
        [8, 231, 0, 3],
        [8, 232, 2, 3],
        [8, 233, 3, 2],
        [8, 234, 1, 4],
        [8, 235, 4, 1],
        [8, 236, 2, 4],
        [8, 237, 1, 5],
        [9, 476, 4, 2],
        [9, 477, 3, 3],
        [9, 478, 0, 4],
        [9, 479, 4, 0],
        [9, 480, 5, 1],
        [9, 481, 2, 5],
        [9, 482, 1, 6],
        [9, 483, 3, 4],
        [9, 484, 5, 2],
        [9, 485, 6, 1],
        [9, 486, 4, 3],
        [10, 974, 0, 5],
        [10, 975, 2, 6],
        [10, 976, 5, 0],
        [10, 977, 1, 7],
        [10, 978, 3, 5],
        [10, 979, 1, 8],
        [10, 980, 8, 1],
        [10, 981, 4, 4],
        [10, 982, 5, 3],
        [10, 983, 6, 2],
        [10, 984, 7, 1],
        [10, 985, 0, 6],
        [10, 986, 8, 2],
        [10, 987, 2, 8],
        [10, 988, 3, 6],
        [10, 989, 2, 7],
        [10, 990, 4, 5],
        [10, 991, 9, 1],
        [10, 992, 1, 9],
        [10, 993, 7, 2],
        [11, 1988, 6, 0],
        [11, 1989, 5, 4],
        [11, 1990, 6, 3],
        [11, 1991, 8, 3],
        [11, 1992, 0, 7],
        [11, 1993, 9, 2],
        [11, 1994, 3, 8],
        [11, 1995, 4, 6],
        [11, 1996, 3, 7],
        [11, 1997, 0, 8],
        [11, 1998, 10, 1],
        [11, 1999, 6, 4],
        [11, 2000, 2, 9],
        [11, 2001, 5, 5],
        [11, 2002, 8, 0],
        [11, 2003, 7, 0],
        [11, 2004, 7, 3],
        [11, 2005, 10, 2],
        [11, 2006, 9, 3],
        [11, 2007, 8, 4],
        [11, 2008, 1, 10],
        [11, 2009, 7, 4],
        [11, 2010, 6, 5],
        [11, 2011, 5, 6],
        [11, 2012, 4, 8],
        [11, 2013, 4, 7],
        [11, 2014, 3, 9],
        [11, 2015, 11, 1],
        [11, 2016, 5, 8],
        [11, 2017, 9, 0],
        [11, 2018, 8, 5],
        [12, 4038, 10, 3],
        [12, 4039, 2, 10],
        [12, 4040, 0, 9],
        [12, 4041, 11, 2],
        [12, 4042, 9, 4],
        [12, 4043, 6, 6],
        [12, 4044, 12, 1],
        [12, 4045, 4, 9],
        [12, 4046, 8, 6],
        [12, 4047, 1, 11],
        [12, 4048, 9, 5],
        [12, 4049, 10, 4],
        [12, 4050, 5, 7],
        [12, 4051, 7, 5],
        [12, 4052, 2, 11],
        [12, 4053, 1, 12],
        [12, 4054, 12, 2],
        [12, 4055, 11, 3],
        [12, 4056, 3, 10],
        [12, 4057, 5, 9],
        [12, 4058, 6, 7],
        [12, 4059, 8, 7],
        [12, 4060, 11, 4],
        [12, 4061, 0, 10],
        [12, 4062, 7, 6],
        [12, 4063, 12, 3],
        [12, 4064, 10, 0],
        [12, 4065, 10, 5],
        [12, 4066, 4, 10],
        [12, 4067, 6, 8],
        [12, 4068, 2, 12],
        [12, 4069, 9, 6],
        [12, 4070, 9, 7],
        [12, 4071, 4, 11],
        [12, 4072, 11, 0],
        [12, 4073, 6, 9],
        [12, 4074, 3, 11],
        [12, 4075, 5, 10],
        [13, 8152, 8, 8],
        [13, 8153, 7, 8],
        [13, 8154, 12, 5],
        [13, 8155, 3, 12],
        [13, 8156, 11, 5],
        [13, 8157, 7, 7],
        [13, 8158, 12, 4],
        [13, 8159, 11, 6],
        [13, 8160, 10, 6],
        [13, 8161, 4, 12],
        [13, 8162, 7, 9],
        [13, 8163, 5, 11],
        [13, 8164, 0, 11],
        [13, 8165, 12, 6],
        [13, 8166, 6, 10],
        [13, 8167, 12, 0],
        [13, 8168, 10, 7],
        [13, 8169, 5, 12],
        [13, 8170, 7, 10],
        [13, 8171, 9, 8],
        [13, 8172, 0, 12],
        [13, 8173, 11, 7],
        [13, 8174, 8, 9],
        [13, 8175, 9, 9],
        [13, 8176, 10, 8],
        [13, 8177, 7, 11],
        [13, 8178, 12, 7],
        [13, 8179, 6, 11],
        [13, 8180, 8, 11],
        [13, 8181, 11, 8],
        [13, 8182, 7, 12],
        [13, 8183, 6, 12],
        [14, 16368, 8, 10],
        [14, 16369, 10, 9],
        [14, 16370, 8, 12],
        [14, 16371, 9, 10],
        [14, 16372, 9, 11],
        [14, 16373, 9, 12],
        [14, 16374, 10, 11],
        [14, 16375, 12, 9],
        [14, 16376, 10, 10],
        [14, 16377, 11, 9],
        [14, 16378, 12, 8],
        [14, 16379, 11, 10],
        [14, 16380, 12, 10],
        [14, 16381, 12, 11],
        [15, 32764, 10, 12],
        [15, 32765, 11, 11],
        [15, 32766, 11, 12],
        [15, 32767, 12, 12],
      ]

      const HCB10 = [
        [4, 0, 1, 1],
        [4, 1, 1, 2],
        [4, 2, 2, 1],
        [5, 6, 2, 2],
        [5, 7, 1, 0],
        [5, 8, 0, 1],
        [5, 9, 1, 3],
        [5, 10, 3, 2],
        [5, 11, 3, 1],
        [5, 12, 2, 3],
        [5, 13, 3, 3],
        [6, 28, 2, 0],
        [6, 29, 0, 2],
        [6, 30, 2, 4],
        [6, 31, 4, 2],
        [6, 32, 1, 4],
        [6, 33, 4, 1],
        [6, 34, 0, 0],
        [6, 35, 4, 3],
        [6, 36, 3, 4],
        [6, 37, 3, 0],
        [6, 38, 0, 3],
        [6, 39, 4, 4],
        [6, 40, 2, 5],
        [6, 41, 5, 2],
        [7, 84, 1, 5],
        [7, 85, 5, 1],
        [7, 86, 5, 3],
        [7, 87, 3, 5],
        [7, 88, 5, 4],
        [7, 89, 4, 5],
        [7, 90, 6, 2],
        [7, 91, 2, 6],
        [7, 92, 6, 3],
        [7, 93, 4, 0],
        [7, 94, 6, 1],
        [7, 95, 0, 4],
        [7, 96, 1, 6],
        [7, 97, 3, 6],
        [7, 98, 5, 5],
        [7, 99, 6, 4],
        [7, 100, 4, 6],
        [8, 202, 6, 5],
        [8, 203, 7, 2],
        [8, 204, 3, 7],
        [8, 205, 2, 7],
        [8, 206, 5, 6],
        [8, 207, 8, 2],
        [8, 208, 7, 3],
        [8, 209, 5, 0],
        [8, 210, 7, 1],
        [8, 211, 0, 5],
        [8, 212, 8, 1],
        [8, 213, 1, 7],
        [8, 214, 8, 3],
        [8, 215, 7, 4],
        [8, 216, 4, 7],
        [8, 217, 2, 8],
        [8, 218, 6, 6],
        [8, 219, 7, 5],
        [8, 220, 1, 8],
        [8, 221, 3, 8],
        [8, 222, 8, 4],
        [8, 223, 4, 8],
        [8, 224, 5, 7],
        [8, 225, 8, 5],
        [8, 226, 5, 8],
        [9, 454, 7, 6],
        [9, 455, 6, 7],
        [9, 456, 9, 2],
        [9, 457, 6, 0],
        [9, 458, 6, 8],
        [9, 459, 9, 3],
        [9, 460, 3, 9],
        [9, 461, 9, 1],
        [9, 462, 2, 9],
        [9, 463, 0, 6],
        [9, 464, 8, 6],
        [9, 465, 9, 4],
        [9, 466, 4, 9],
        [9, 467, 10, 2],
        [9, 468, 1, 9],
        [9, 469, 7, 7],
        [9, 470, 8, 7],
        [9, 471, 9, 5],
        [9, 472, 7, 8],
        [9, 473, 10, 3],
        [9, 474, 5, 9],
        [9, 475, 10, 4],
        [9, 476, 2, 10],
        [9, 477, 10, 1],
        [9, 478, 3, 10],
        [9, 479, 9, 6],
        [9, 480, 6, 9],
        [9, 481, 8, 0],
        [9, 482, 4, 10],
        [9, 483, 7, 0],
        [9, 484, 11, 2],
        [10, 970, 7, 9],
        [10, 971, 11, 3],
        [10, 972, 10, 6],
        [10, 973, 1, 10],
        [10, 974, 11, 1],
        [10, 975, 9, 7],
        [10, 976, 0, 7],
        [10, 977, 8, 8],
        [10, 978, 10, 5],
        [10, 979, 3, 11],
        [10, 980, 5, 10],
        [10, 981, 8, 9],
        [10, 982, 11, 5],
        [10, 983, 0, 8],
        [10, 984, 11, 4],
        [10, 985, 2, 11],
        [10, 986, 7, 10],
        [10, 987, 6, 10],
        [10, 988, 10, 7],
        [10, 989, 4, 11],
        [10, 990, 1, 11],
        [10, 991, 12, 2],
        [10, 992, 9, 8],
        [10, 993, 12, 3],
        [10, 994, 11, 6],
        [10, 995, 5, 11],
        [10, 996, 12, 4],
        [10, 997, 11, 7],
        [10, 998, 12, 5],
        [10, 999, 3, 12],
        [10, 1000, 6, 11],
        [10, 1001, 9, 0],
        [10, 1002, 10, 8],
        [10, 1003, 10, 0],
        [10, 1004, 12, 1],
        [10, 1005, 0, 9],
        [10, 1006, 4, 12],
        [10, 1007, 9, 9],
        [10, 1008, 12, 6],
        [10, 1009, 2, 12],
        [10, 1010, 8, 10],
        [11, 2022, 9, 10],
        [11, 2023, 1, 12],
        [11, 2024, 11, 8],
        [11, 2025, 12, 7],
        [11, 2026, 7, 11],
        [11, 2027, 5, 12],
        [11, 2028, 6, 12],
        [11, 2029, 10, 9],
        [11, 2030, 8, 11],
        [11, 2031, 12, 8],
        [11, 2032, 0, 10],
        [11, 2033, 7, 12],
        [11, 2034, 11, 0],
        [11, 2035, 10, 10],
        [11, 2036, 11, 9],
        [11, 2037, 11, 10],
        [11, 2038, 0, 11],
        [11, 2039, 11, 11],
        [11, 2040, 9, 11],
        [11, 2041, 10, 11],
        [11, 2042, 12, 0],
        [11, 2043, 8, 12],
        [12, 4088, 12, 9],
        [12, 4089, 10, 12],
        [12, 4090, 9, 12],
        [12, 4091, 11, 12],
        [12, 4092, 12, 11],
        [12, 4093, 0, 12],
        [12, 4094, 12, 10],
        [12, 4095, 12, 12],
      ]

      const HCB11 = [
        [4, 0, 0, 0],
        [4, 1, 1, 1],
        [5, 4, 16, 16],
        [5, 5, 1, 0],
        [5, 6, 0, 1],
        [5, 7, 2, 1],
        [5, 8, 1, 2],
        [5, 9, 2, 2],
        [6, 20, 1, 3],
        [6, 21, 3, 1],
        [6, 22, 3, 2],
        [6, 23, 2, 0],
        [6, 24, 2, 3],
        [6, 25, 0, 2],
        [6, 26, 3, 3],
        [7, 54, 4, 1],
        [7, 55, 1, 4],
        [7, 56, 4, 2],
        [7, 57, 2, 4],
        [7, 58, 4, 3],
        [7, 59, 3, 4],
        [7, 60, 3, 0],
        [7, 61, 0, 3],
        [7, 62, 5, 1],
        [7, 63, 5, 2],
        [7, 64, 2, 5],
        [7, 65, 4, 4],
        [7, 66, 1, 5],
        [7, 67, 5, 3],
        [7, 68, 3, 5],
        [7, 69, 5, 4],
        [8, 140, 4, 5],
        [8, 141, 6, 2],
        [8, 142, 2, 6],
        [8, 143, 6, 1],
        [8, 144, 6, 3],
        [8, 145, 3, 6],
        [8, 146, 1, 6],
        [8, 147, 4, 16],
        [8, 148, 3, 16],
        [8, 149, 16, 5],
        [8, 150, 16, 3],
        [8, 151, 16, 4],
        [8, 152, 6, 4],
        [8, 153, 16, 6],
        [8, 154, 4, 0],
        [8, 155, 4, 6],
        [8, 156, 0, 4],
        [8, 157, 2, 16],
        [8, 158, 5, 5],
        [8, 159, 5, 16],
        [8, 160, 16, 7],
        [8, 161, 16, 2],
        [8, 162, 16, 8],
        [8, 163, 2, 7],
        [8, 164, 7, 2],
        [8, 165, 3, 7],
        [8, 166, 6, 5],
        [8, 167, 5, 6],
        [8, 168, 6, 16],
        [8, 169, 16, 10],
        [8, 170, 7, 3],
        [8, 171, 7, 1],
        [8, 172, 16, 9],
        [8, 173, 7, 16],
        [8, 174, 1, 16],
        [8, 175, 1, 7],
        [8, 176, 4, 7],
        [8, 177, 16, 11],
        [8, 178, 7, 4],
        [8, 179, 16, 12],
        [8, 180, 8, 16],
        [8, 181, 16, 1],
        [8, 182, 6, 6],
        [8, 183, 9, 16],
        [8, 184, 2, 8],
        [8, 185, 5, 7],
        [8, 186, 10, 16],
        [8, 187, 16, 13],
        [8, 188, 8, 3],
        [8, 189, 8, 2],
        [8, 190, 3, 8],
        [8, 191, 5, 0],
        [8, 192, 16, 14],
        [8, 193, 11, 16],
        [8, 194, 7, 5],
        [8, 195, 4, 8],
        [8, 196, 6, 7],
        [8, 197, 7, 6],
        [8, 198, 0, 5],
        [9, 398, 8, 4],
        [9, 399, 16, 15],
        [9, 400, 12, 16],
        [9, 401, 1, 8],
        [9, 402, 8, 1],
        [9, 403, 14, 16],
        [9, 404, 5, 8],
        [9, 405, 13, 16],
        [9, 406, 3, 9],
        [9, 407, 8, 5],
        [9, 408, 7, 7],
        [9, 409, 2, 9],
        [9, 410, 8, 6],
        [9, 411, 9, 2],
        [9, 412, 9, 3],
        [9, 413, 15, 16],
        [9, 414, 4, 9],
        [9, 415, 6, 8],
        [9, 416, 6, 0],
        [9, 417, 9, 4],
        [9, 418, 5, 9],
        [9, 419, 8, 7],
        [9, 420, 7, 8],
        [9, 421, 1, 9],
        [9, 422, 10, 3],
        [9, 423, 0, 6],
        [9, 424, 10, 2],
        [9, 425, 9, 1],
        [9, 426, 9, 5],
        [9, 427, 4, 10],
        [9, 428, 2, 10],
        [9, 429, 9, 6],
        [9, 430, 3, 10],
        [9, 431, 6, 9],
        [9, 432, 10, 4],
        [9, 433, 8, 8],
        [9, 434, 10, 5],
        [9, 435, 9, 7],
        [9, 436, 11, 3],
        [9, 437, 1, 10],
        [9, 438, 7, 0],
        [9, 439, 10, 6],
        [9, 440, 7, 9],
        [9, 441, 3, 11],
        [9, 442, 5, 10],
        [9, 443, 10, 1],
        [9, 444, 4, 11],
        [9, 445, 11, 2],
        [9, 446, 13, 2],
        [9, 447, 6, 10],
        [9, 448, 13, 3],
        [9, 449, 2, 11],
        [9, 450, 16, 0],
        [9, 451, 5, 11],
        [9, 452, 11, 5],
        [10, 906, 11, 4],
        [10, 907, 9, 8],
        [10, 908, 7, 10],
        [10, 909, 8, 9],
        [10, 910, 0, 16],
        [10, 911, 4, 13],
        [10, 912, 0, 7],
        [10, 913, 3, 13],
        [10, 914, 11, 6],
        [10, 915, 13, 1],
        [10, 916, 13, 4],
        [10, 917, 12, 3],
        [10, 918, 2, 13],
        [10, 919, 13, 5],
        [10, 920, 8, 10],
        [10, 921, 6, 11],
        [10, 922, 10, 8],
        [10, 923, 10, 7],
        [10, 924, 14, 2],
        [10, 925, 12, 4],
        [10, 926, 1, 11],
        [10, 927, 4, 12],
        [10, 928, 11, 1],
        [10, 929, 3, 12],
        [10, 930, 1, 13],
        [10, 931, 12, 2],
        [10, 932, 7, 11],
        [10, 933, 3, 14],
        [10, 934, 5, 12],
        [10, 935, 5, 13],
        [10, 936, 14, 4],
        [10, 937, 4, 14],
        [10, 938, 11, 7],
        [10, 939, 14, 3],
        [10, 940, 12, 5],
        [10, 941, 13, 6],
        [10, 942, 12, 6],
        [10, 943, 8, 0],
        [10, 944, 11, 8],
        [10, 945, 2, 12],
        [10, 946, 9, 9],
        [10, 947, 14, 5],
        [10, 948, 6, 13],
        [10, 949, 10, 10],
        [10, 950, 15, 2],
        [10, 951, 8, 11],
        [10, 952, 9, 10],
        [10, 953, 14, 6],
        [10, 954, 10, 9],
        [10, 955, 5, 14],
        [10, 956, 11, 9],
        [10, 957, 14, 1],
        [10, 958, 2, 14],
        [10, 959, 6, 12],
        [10, 960, 1, 12],
        [10, 961, 13, 8],
        [10, 962, 0, 8],
        [10, 963, 13, 7],
        [10, 964, 7, 12],
        [10, 965, 12, 7],
        [10, 966, 7, 13],
        [10, 967, 15, 3],
        [10, 968, 12, 1],
        [10, 969, 6, 14],
        [10, 970, 2, 15],
        [10, 971, 15, 5],
        [10, 972, 15, 4],
        [10, 973, 1, 14],
        [10, 974, 9, 11],
        [10, 975, 4, 15],
        [10, 976, 14, 7],
        [10, 977, 8, 13],
        [10, 978, 13, 9],
        [10, 979, 8, 12],
        [10, 980, 5, 15],
        [10, 981, 3, 15],
        [10, 982, 10, 11],
        [10, 983, 11, 10],
        [10, 984, 12, 8],
        [10, 985, 15, 6],
        [10, 986, 15, 7],
        [10, 987, 8, 14],
        [10, 988, 15, 1],
        [10, 989, 7, 14],
        [10, 990, 9, 0],
        [10, 991, 0, 9],
        [10, 992, 9, 13],
        [10, 993, 9, 12],
        [10, 994, 12, 9],
        [10, 995, 14, 8],
        [10, 996, 10, 13],
        [10, 997, 14, 9],
        [10, 998, 12, 10],
        [10, 999, 6, 15],
        [10, 1000, 7, 15],
        [11, 2002, 9, 14],
        [11, 2003, 15, 8],
        [11, 2004, 11, 11],
        [11, 2005, 11, 14],
        [11, 2006, 1, 15],
        [11, 2007, 10, 12],
        [11, 2008, 10, 14],
        [11, 2009, 13, 11],
        [11, 2010, 13, 10],
        [11, 2011, 11, 13],
        [11, 2012, 11, 12],
        [11, 2013, 8, 15],
        [11, 2014, 14, 11],
        [11, 2015, 13, 12],
        [11, 2016, 12, 13],
        [11, 2017, 15, 9],
        [11, 2018, 14, 10],
        [11, 2019, 10, 0],
        [11, 2020, 12, 11],
        [11, 2021, 9, 15],
        [11, 2022, 0, 10],
        [11, 2023, 12, 12],
        [11, 2024, 11, 0],
        [11, 2025, 12, 14],
        [11, 2026, 10, 15],
        [11, 2027, 13, 13],
        [11, 2028, 0, 13],
        [11, 2029, 14, 12],
        [11, 2030, 15, 10],
        [11, 2031, 15, 11],
        [11, 2032, 11, 15],
        [11, 2033, 14, 13],
        [11, 2034, 13, 0],
        [11, 2035, 0, 11],
        [11, 2036, 13, 14],
        [11, 2037, 15, 12],
        [11, 2038, 15, 13],
        [11, 2039, 12, 15],
        [11, 2040, 14, 0],
        [11, 2041, 14, 14],
        [11, 2042, 13, 15],
        [11, 2043, 12, 0],
        [11, 2044, 14, 15],
        [12, 4090, 0, 14],
        [12, 4091, 0, 12],
        [12, 4092, 15, 14],
        [12, 4093, 15, 0],
        [12, 4094, 0, 15],
        [12, 4095, 15, 15],
      ]

      const HCB_SF = [
        [1, 0, 60],
        [3, 4, 59],
        [4, 10, 61],
        [4, 11, 58],
        [4, 12, 62],
        [5, 26, 57],
        [5, 27, 63],
        [6, 56, 56],
        [6, 57, 64],
        [6, 58, 55],
        [6, 59, 65],
        [7, 120, 66],
        [7, 121, 54],
        [7, 122, 67],
        [8, 246, 53],
        [8, 247, 68],
        [8, 248, 52],
        [8, 249, 69],
        [8, 250, 51],
        [9, 502, 70],
        [9, 503, 50],
        [9, 504, 49],
        [9, 505, 71],
        [10, 1012, 72],
        [10, 1013, 48],
        [10, 1014, 73],
        [10, 1015, 47],
        [10, 1016, 74],
        [10, 1017, 46],
        [11, 2036, 76],
        [11, 2037, 75],
        [11, 2038, 77],
        [11, 2039, 78],
        [11, 2040, 45],
        [11, 2041, 43],
        [12, 4084, 44],
        [12, 4085, 79],
        [12, 4086, 42],
        [12, 4087, 41],
        [12, 4088, 80],
        [12, 4089, 40],
        [13, 8180, 81],
        [13, 8181, 39],
        [13, 8182, 82],
        [13, 8183, 38],
        [13, 8184, 83],
        [14, 16370, 37],
        [14, 16371, 35],
        [14, 16372, 85],
        [14, 16373, 33],
        [14, 16374, 36],
        [14, 16375, 34],
        [14, 16376, 84],
        [14, 16377, 32],
        [15, 32756, 87],
        [15, 32757, 89],
        [15, 32758, 30],
        [15, 32759, 31],
        [16, 65520, 86],
        [16, 65521, 29],
        [16, 65522, 26],
        [16, 65523, 27],
        [16, 65524, 28],
        [16, 65525, 24],
        [16, 65526, 88],
        [17, 131054, 25],
        [17, 131055, 22],
        [17, 131056, 23],
        [18, 262114, 90],
        [18, 262115, 21],
        [18, 262116, 19],
        [18, 262117, 3],
        [18, 262118, 1],
        [18, 262119, 2],
        [18, 262120, 0],
        [19, 524242, 98],
        [19, 524243, 99],
        [19, 524244, 100],
        [19, 524245, 101],
        [19, 524246, 102],
        [19, 524247, 117],
        [19, 524248, 97],
        [19, 524249, 91],
        [19, 524250, 92],
        [19, 524251, 93],
        [19, 524252, 94],
        [19, 524253, 95],
        [19, 524254, 96],
        [19, 524255, 104],
        [19, 524256, 111],
        [19, 524257, 112],
        [19, 524258, 113],
        [19, 524259, 114],
        [19, 524260, 115],
        [19, 524261, 116],
        [19, 524262, 110],
        [19, 524263, 105],
        [19, 524264, 106],
        [19, 524265, 107],
        [19, 524266, 108],
        [19, 524267, 109],
        [19, 524268, 118],
        [19, 524269, 6],
        [19, 524270, 8],
        [19, 524271, 9],
        [19, 524272, 10],
        [19, 524273, 5],
        [19, 524274, 103],
        [19, 524275, 120],
        [19, 524276, 119],
        [19, 524277, 4],
        [19, 524278, 7],
        [19, 524279, 15],
        [19, 524280, 16],
        [19, 524281, 18],
        [19, 524282, 20],
        [19, 524283, 17],
        [19, 524284, 11],
        [19, 524285, 12],
        [19, 524286, 14],
        [19, 524287, 13],
      ]

      const CODEBOOKS = [
        HCB1,
        HCB2,
        HCB3,
        HCB4,
        HCB5,
        HCB6,
        HCB7,
        HCB8,
        HCB9,
        HCB10,
        HCB11,
      ]
      const UNSIGNED = [
          false,
          false,
          true,
          true,
          false,
          false,
          true,
          true,
          true,
          true,
          true,
        ],
        QUAD_LEN = 4,
        PAIR_LEN = 2

      var Huffman = {
        findOffset: function(stream, table) {
          var off = 0,
            len = table[off][0],
            cw = stream.read(len)

          while (cw !== table[off][1]) {
            var j = table[++off][0] - len
            len = table[off][0]
            cw <<= j
            cw |= stream.read(j)
          }

          return off
        },

        signValues: function(stream, data, off, len) {
          for (var i = off; i < off + len; i++) {
            if (data[i] && stream.read(1)) data[i] = -data[i]
          }
        },

        getEscape: function(stream, s) {
          var i = 4
          while (stream.read(1)) i++

          var j = stream.read(i) | (1 << i)
          return s < 0 ? -j : j
        },

        decodeScaleFactor: function(stream) {
          var offset = this.findOffset(stream, HCB_SF)
          return HCB_SF[offset][2]
        },

        decodeSpectralData: function(stream, cb, data, off) {
          var HCB = CODEBOOKS[cb - 1],
            offset = this.findOffset(stream, HCB)

          data[off] = HCB[offset][2]
          data[off + 1] = HCB[offset][3]

          if (cb < 5) {
            data[off + 2] = HCB[offset][4]
            data[off + 3] = HCB[offset][5]
          }

          // sign and escape
          if (cb < 11) {
            if (UNSIGNED[cb - 1])
              this.signValues(
                stream,
                data,
                off,
                cb < 5 ? QUAD_LEN : PAIR_LEN
              )
          } else if (cb === 11 || cb > 15) {
            this.signValues(
              stream,
              data,
              off,
              cb < 5 ? QUAD_LEN : PAIR_LEN
            )

            if (Math.abs(data[off]) === 16)
              data[off] = this.getEscape(stream, data[off])

            if (Math.abs(data[off + 1]) === 16)
              data[off + 1] = this.getEscape(stream, data[off + 1])
          } else {
            throw new Error(
              "Huffman: unknown spectral codebook: " + cb
            )
          }
        },
      }

      return Huffman
    })()

    var ICStream = (function() {
      // Individual Channel Stream
      function ICStream(config) {
        this.info = new ICSInfo()
        this.bandTypes = new Int32Array(MAX_SECTIONS)
        this.sectEnd = new Int32Array(MAX_SECTIONS)
        this.data = new Float32Array(config.frameLength)
        this.scaleFactors = new Float32Array(MAX_SECTIONS)
        this.randomState = 0x1f2e3d4c
        this.tns = new TNS(config)
        this.specBuf = new Int32Array(4)
      }

      ICStream.ZERO_BT = 0 // Scalefactors and spectral data are all zero.
      ICStream.FIRST_PAIR_BT = 5 // This and later band types encode two values (rather than four) with one code word.
      ICStream.ESC_BT = 11 // Spectral data are coded with an escape sequence.
      ICStream.NOISE_BT = 13 // Spectral data are scaled white noise not coded in the bitstream.
      ICStream.INTENSITY_BT2 = 14 // Scalefactor data are intensity stereo positions.
      ICStream.INTENSITY_BT = 15 // Scalefactor data are intensity stereo positions.

      ICStream.ONLY_LONG_SEQUENCE = 0
      ICStream.LONG_START_SEQUENCE = 1
      ICStream.EIGHT_SHORT_SEQUENCE = 2
      ICStream.LONG_STOP_SEQUENCE = 3

      const MAX_SECTIONS = 120,
        MAX_WINDOW_GROUP_COUNT = 8

      const SF_DELTA = 60,
        SF_OFFSET = 200

      ICStream.prototype = {
        decode: function(stream, config, commonWindow) {
          this.globalGain = stream.read(8)

          if (!commonWindow)
            this.info.decode(stream, config, commonWindow)

          this.decodeBandTypes(stream, config)
          this.decodeScaleFactors(stream)

          if ((this.pulsePresent = stream.read(1))) {
            if (
              this.info.windowSequence ===
              ICStream.EIGHT_SHORT_SEQUENCE
            )
              throw new Error(
                "Pulse tool not allowed in eight short sequence."
              )

            this.decodePulseData(stream)
          }

          if ((this.tnsPresent = stream.read(1))) {
            this.tns.decode(stream, this.info)
          }

          if ((this.gainPresent = stream.read(1))) {
            throw new Error("TODO: decode gain control/SSR")
          }

          this.decodeSpectralData(stream)
        },

        decodeBandTypes: function(stream, config) {
          var bits =
              this.info.windowSequence ===
              ICStream.EIGHT_SHORT_SEQUENCE
                ? 3
                : 5,
            groupCount = this.info.groupCount,
            maxSFB = this.info.maxSFB,
            bandTypes = this.bandTypes,
            sectEnd = this.sectEnd,
            idx = 0,
            escape = (1 << bits) - 1

          for (var g = 0; g < groupCount; g++) {
            var k = 0
            while (k < maxSFB) {
              var end = k,
                bandType = stream.read(4)

              if (bandType === 12)
                throw new Error("Invalid band type: 12")

              var incr
              while ((incr = stream.read(bits)) === escape)
                end += incr

              end += incr

              if (end > maxSFB)
                throw new Error(
                  "Too many bands (" + end + " > " + maxSFB + ")"
                )

              for (; k < end; k++) {
                bandTypes[idx] = bandType
                sectEnd[idx++] = end
              }
            }
          }
        },

        decodeScaleFactors: function(stream) {
          var groupCount = this.info.groupCount,
            maxSFB = this.info.maxSFB,
            offset = [this.globalGain, this.globalGain - 90, 0], // spectrum, noise, intensity
            idx = 0,
            noiseFlag = true,
            scaleFactors = this.scaleFactors,
            sectEnd = this.sectEnd,
            bandTypes = this.bandTypes

          for (var g = 0; g < groupCount; g++) {
            for (var i = 0; i < maxSFB; ) {
              var runEnd = sectEnd[idx]

              switch (bandTypes[idx]) {
                case ICStream.ZERO_BT:
                  for (; i < runEnd; i++, idx++) {
                    scaleFactors[idx] = 0
                  }
                  break

                case ICStream.INTENSITY_BT:
                case ICStream.INTENSITY_BT2:
                  for (; i < runEnd; i++, idx++) {
                    offset[2] +=
                      Huffman.decodeScaleFactor(stream) - SF_DELTA
                    var tmp = Math.min(Math.max(offset[2], -155), 100)
                    scaleFactors[idx] =
                      SCALEFACTOR_TABLE[-tmp + SF_OFFSET]
                  }
                  break

                case ICStream.NOISE_BT:
                  for (; i < runEnd; i++, idx++) {
                    if (noiseFlag) {
                      offset[1] += stream.read(9) - 256
                      noiseFlag = false
                    } else {
                      offset[1] +=
                        Huffman.decodeScaleFactor(stream) - SF_DELTA
                    }
                    var tmp = Math.min(Math.max(offset[1], -100), 155)
                    scaleFactors[idx] = -SCALEFACTOR_TABLE[
                      tmp + SF_OFFSET
                    ]
                  }
                  break

                default:
                  for (; i < runEnd; i++, idx++) {
                    offset[0] +=
                      Huffman.decodeScaleFactor(stream) - SF_DELTA
                    if (offset[0] > 255)
                      throw new Error(
                        "Scalefactor out of range: " + offset[0]
                      )

                    scaleFactors[idx] =
                      SCALEFACTOR_TABLE[offset[0] - 100 + SF_OFFSET]
                  }
                  break
              }
            }
          }
        },

        decodePulseData: function(stream) {
          var pulseCount = stream.read(2) + 1,
            pulseSWB = stream.read(6)

          if (pulseSWB >= this.info.swbCount)
            throw new Error("Pulse SWB out of range: " + pulseSWB)

          if (
            !this.pulseOffset ||
            this.pulseOffset.length !== pulseCount
          ) {
            // only reallocate if needed
            this.pulseOffset = new Int32Array(pulseCount)
            this.pulseAmp = new Int32Array(pulseCount)
          }

          this.pulseOffset[0] =
            this.info.swbOffsets[pulseSWB] + stream.read(5)
          this.pulseAmp[0] = stream.read(4)

          if (this.pulseOffset[0] > 1023)
            throw new Error(
              "Pulse offset out of range: " + this.pulseOffset[0]
            )

          for (var i = 1; i < pulseCount; i++) {
            this.pulseOffset[i] =
              stream.read(5) + this.pulseOffset[i - 1]
            if (this.pulseOffset[i] > 1023)
              throw new Error(
                "Pulse offset out of range: " + this.pulseOffset[i]
              )

            this.pulseAmp[i] = stream.read(4)
          }
        },

        decodeSpectralData: function(stream) {
          var data = this.data,
            info = this.info,
            maxSFB = info.maxSFB,
            windowGroups = info.groupCount,
            offsets = info.swbOffsets,
            bandTypes = this.bandTypes,
            scaleFactors = this.scaleFactors,
            buf = this.specBuf

          var groupOff = 0,
            idx = 0
          for (var g = 0; g < windowGroups; g++) {
            var groupLen = info.groupLength[g]

            for (var sfb = 0; sfb < maxSFB; sfb++, idx++) {
              var hcb = bandTypes[idx],
                off = groupOff + offsets[sfb],
                v1024 = v1024[sfb + 1] - offsets[sfb]

              if (
                hcb === ICStream.ZERO_BT ||
                hcb === ICStream.INTENSITY_BT ||
                hcb === ICStream.INTENSITY_BT2
              ) {
                for (
                  var group = 0;
                  group < groupLen;
                  group++, off += 128
                ) {
                  for (var i = off; i < off + width; i++) {
                    data[i] = 0
                  }
                }
              } else if (hcb === ICStream.NOISE_BT) {
                // fill with random values
                for (
                  var group = 0;
                  group < groupLen;
                  group++, off += 128
                ) {
                  var energy = 0

                  for (var k = 0; k < width; k++) {
                    this.randomState *= 1664525 + 1013904223
                    data[off + k] = this.randomState
                    energy += data[off + k] * data[off + k]
                  }

                  var scale = scaleFactors[idx] / Math.sqrt(energy)
                  for (var k = 0; k < width; k++) {
                    data[off + k] *= scale
                  }
                }
              } else {
                for (
                  var group = 0;
                  group < groupLen;
                  group++, off += 128
                ) {
                  var num = hcb >= ICStream.FIRST_PAIR_BT ? 2 : 4
                  for (var k = 0; k < width; k += num) {
                    Huffman.decodeSpectralData(stream, hcb, buf, 0)

                    // inverse quantization & scaling
                    for (var j = 0; j < num; j++) {
                      data[off + k + j] =
                        buf[j] > 0
                          ? IQ_TABLE[buf[j]]
                          : -IQ_TABLE[-buf[j]]
                      data[off + k + j] *= scaleFactors[idx]
                    }
                  }
                }
              }
            }
            groupOff += groupLen << 7
          }

          // add pulse data, if present
          if (this.pulsePresent) {
            throw new Error("TODO: add pulse data")
          }
        },
      }

      // Individual Channel Stream Info
      function ICSInfo() {
        this.windowShape = new Int32Array(2)
        this.windowSequence = ICStream.ONLY_LONG_SEQUENCE
        this.groupLength = new Int32Array(MAX_WINDOW_GROUP_COUNT)
        this.ltpData1Present = false
        this.ltpData2Present = false
      }

      ICSInfo.prototype = {
        decode: function(stream, config, commonWindow) {
          stream.advance(1) // reserved

          this.windowSequence = stream.read(2)
          this.windowShape[0] = this.windowShape[1]
          this.windowShape[1] = stream.read(1)

          this.groupCount = 1
          this.groupLength[0] = 1

          if (this.windowSequence === ICStream.EIGHT_SHORT_SEQUENCE) {
            this.maxSFB = stream.read(4)
            for (var i = 0; i < 7; i++) {
              if (stream.read(1)) {
                this.groupLength[this.groupCount - 1]++
              } else {
                this.groupCount++
                this.groupLength[this.groupCount - 1] = 1
              }
            }

            this.windowCount = 8
            this.swbOffsets = SWB_OFFSET_128[config.sampleIndex]
            this.swbCount = SWB_SHORT_WINDOW_COUNT[config.sampleIndex]
            this.predictorPresent = false
          } else {
            this.maxSFB = stream.read(6)
            this.windowCount = 1
            this.swbOffsets = SWB_OFFSET_1024[config.sampleIndex]
            this.swbCount = SWB_LONG_WINDOW_COUNT[config.sampleIndex]
            this.predictorPresent = !!stream.read(1)

            if (this.predictorPresent)
              this.decodePrediction(stream, config, commonWindow)
          }
        },

        decodePrediction: function(stream, config, commonWindow) {
          return
          throw new Error("Prediction not implemented.")

          switch (config.profile) {
            case AOT_AAC_MAIN:
              throw new Error("Prediction not implemented.")
              break

            case AOT_AAC_LTP:
              throw new Error("LTP prediction not implemented.")
              break

            default:
              throw new Error(
                "Unsupported profile for prediction " + config.profile
              )
          }
        },
      }

      return ICStream
    })()

    // Modified Discrete Cosine Transform
    function MDCT(length) {
      this.N = length
      this.N2 = length >>> 1
      this.N4 = length >>> 2
      this.N8 = length >>> 3

      switch (length) {
        case 2048:
          this.sincos = MDCT_TABLE_2048
          break

        case 256:
          this.sincos = MDCT_TABLE_256
          break

        case 1920:
          this.sincos = MDCT_TABLE_1920
          break

        case 240:
          this.sincos = MDCT_TABLE_240
          break

        default:
          throw new Error("unsupported MDCT length: " + length)
      }

      this.fft = new FFT(this.N4)

      this.buf = new Array(this.N4)
      for (var i = 0; i < this.N4; i++) {
        this.buf[i] = new Float32Array(2)
      }

      this.tmp = new Float32Array(2)
    }

    MDCT.prototype.process = function(
      input,
      inOffset,
      output,
      outOffset
    ) {
      // local access
      var N2 = this.N2,
        N4 = this.N4,
        N8 = this.N8,
        buf = this.buf,
        tmp = this.tmp,
        sincos = this.sincos,
        fft = this.fft

      // pre-IFFT complex multiplication
      for (var k = 0; k < N4; k++) {
        buf[k][1] =
          input[inOffset + 2 * k] * sincos[k][0] +
          input[inOffset + N2 - 1 - 2 * k] * sincos[k][1]
        buf[k][0] =
          input[inOffset + N2 - 1 - 2 * k] * sincos[k][0] -
          input[inOffset + 2 * k] * sincos[k][1]
      }

      // complex IFFT, non-scaling
      fft.process(buf, false)

      // post-IFFT complex multiplication
      for (var k = 0; k < N4; k++) {
        tmp[0] = buf[k][0]
        tmp[1] = buf[k][1]
        buf[k][1] = tmp[1] * sincos[k][0] + tmp[0] * sincos[k][1]
        buf[k][0] = tmp[0] * sincos[k][0] - tmp[1] * sincos[k][1]
      }

      // reordering
      for (var k = 0; k < N8; k += 2) {
        output[outOffset + 2 * k] = buf[N8 + k][1]
        output[outOffset + 2 + 2 * k] = buf[N8 + 1 + k][1]

        output[outOffset + 1 + 2 * k] = -buf[N8 - 1 - k][0]
        output[outOffset + 3 + 2 * k] = -buf[N8 - 2 - k][0]

        output[outOffset + N4 + 2 * k] = buf[k][0]
        output[outOffset + N4 + 2 + 2 * k] = buf[1 + k][0]

        output[outOffset + N4 + 1 + 2 * k] = -buf[N4 - 1 - k][1]
        output[outOffset + N4 + 3 + 2 * k] = -buf[N4 - 2 - k][1]

        output[outOffset + N2 + 2 * k] = buf[N8 + k][0]
        output[outOffset + N2 + 2 + 2 * k] = buf[N8 + 1 + k][0]

        output[outOffset + N2 + 1 + 2 * k] = -buf[N8 - 1 - k][1]
        output[outOffset + N2 + 3 + 2 * k] = -buf[N8 - 2 - k][1]

        output[outOffset + N2 + N4 + 2 * k] = -buf[k][1]
        output[outOffset + N2 + N4 + 2 + 2 * k] = -buf[1 + k][1]

        output[outOffset + N2 + N4 + 1 + 2 * k] = buf[N4 - 1 - k][0]
        output[outOffset + N2 + N4 + 3 + 2 * k] = buf[N4 - 2 - k][0]
      }
    }

    const MDCT_TABLE_2048 = [
      [0.031249997702054, 0.000011984224612],
      [0.031249813866531, 0.000107857810004],
      [0.031249335895858, 0.000203730380198],
      [0.031248563794535, 0.000299601032804],
      [0.031247497569829, 0.000395468865451],
      [0.031246137231775, 0.000491332975794],
      [0.031244482793177, 0.000587192461525],
      [0.031242534269608, 0.000683046420376],
      [0.031240291679407, 0.000778893950134],
      [0.031237755043684, 0.000874734148645],
      [0.031234924386313, 0.000970566113826],
      [0.031231799733938, 0.001066388943669],
      [0.03122838111597, 0.001162201736253],
      [0.031224668564585, 0.001258003589751],
      [0.031220662114728, 0.001353793602441],
      [0.031216361804108, 0.00144957087271],
      [0.031211767673203, 0.001545334499065],
      [0.031206879765253, 0.001641083580144],
      [0.031201698126266, 0.001736817214719],
      [0.031196222805014, 0.001832534501709],
      [0.031190453853031, 0.001928234540186],
      [0.031184391324617, 0.002023916429386],
      [0.031178035276836, 0.002119579268713],
      [0.031171385769513, 0.002215222157753],
      [0.031164442865236, 0.002310844196278],
      [0.031157206629353, 0.002406444484258],
      [0.031149677129975, 0.002502022121865],
      [0.031141854437973, 0.002597576209488],
      [0.031133738626977, 0.002693105847734],
      [0.031125329773375, 0.002788610137442],
      [0.031116627956316, 0.002884088179689],
      [0.031107633257703, 0.002979539075801],
      [0.0310983457622, 0.003074961927355],
      [0.031088765557222, 0.003170355836197],
      [0.031078892732942, 0.003265719904442],
      [0.031068727382288, 0.003361053234488],
      [0.031058269600939, 0.003456354929021],
      [0.031047519487329, 0.003551624091024],
      [0.03103647714264, 0.00364685982379],
      [0.031025142670809, 0.003742061230921],
      [0.031013516178519, 0.003837227416347],
      [0.031001597775203, 0.003932357484328],
      [0.030989387573042, 0.004027450539462],
      [0.030976885686963, 0.004122505686697],
      [0.030964092234638, 0.00421752203134],
      [0.030951007336485, 0.004312498679058],
      [0.030937631115663, 0.004407434735897],
      [0.030923963698074, 0.004502329308281],
      [0.030910005212362, 0.004597181503027],
      [0.030895755789908, 0.00469199042735],
      [0.030881215564835, 0.004786755188872],
      [0.030866384674, 0.004881474895632],
      [0.030851263256996, 0.00497614865609],
      [0.030835851456154, 0.005070775579142],
      [0.030820149416533, 0.005165354774124],
      [0.030804157285929, 0.005259885350819],
      [0.030787875214864, 0.005354366419469],
      [0.030771303356593, 0.005448797090784],
      [0.030754441867095, 0.005543176475946],
      [0.030737290905077, 0.005637503686619],
      [0.030719850631972, 0.005731777834961],
      [0.030702121211932, 0.005825998033626],
      [0.030684102811835, 0.00592016339578],
      [0.030665795601276, 0.006014273035101],
      [0.03064719975257, 0.006108326065793],
      [0.030628315440748, 0.006202321602594],
      [0.030609142843557, 0.006296258760782],
      [0.030589682141455, 0.006390136656185],
      [0.030569933517616, 0.006483954405188],
      [0.030549897157919, 0.006577711124743],
      [0.030529573250956, 0.006671405932375],
      [0.030508961988022, 0.006765037946194],
      [0.030488063563118, 0.0068586062849],
      [0.030466878172949, 0.006952110067791],
      [0.030445406016919, 0.007045548414774],
      [0.030423647297133, 0.007138920446372],
      [0.030401602218392, 0.007232225283733],
      [0.030379270988192, 0.007325462048634],
      [0.030356653816724, 0.007418629863497],
      [0.030333750916869, 0.00751172785139],
      [0.030310562504198, 0.00760475513604],
      [0.030287088796968, 0.007697710841838],
      [0.030263330016124, 0.007790594093851],
      [0.030239286385293, 0.007883404017824],
      [0.030214958130781, 0.007976139740197],
      [0.030190345481576, 0.008068800388104],
      [0.030165448669342, 0.00816138508939],
      [0.030140267928416, 0.00825389297261],
      [0.030114803495809, 0.008346323167047],
      [0.030089055611203, 0.008438674802711],
      [0.030063024516947, 0.008530947010354],
      [0.030036710458054, 0.008623138921475],
      [0.030010113682202, 0.008715249668328],
      [0.029983234439732, 0.008807278383932],
      [0.02995607298364, 0.008899224202078],
      [0.02992862956958, 0.008991086257336],
      [0.02990090445586, 0.009082863685067],
      [0.029872897903441, 0.009174555621425],
      [0.029844610175929, 0.009266161203371],
      [0.029816041539579, 0.009357679568679],
      [0.029787192263292, 0.009449109855944],
      [0.029758062618606, 0.009540451204587],
      [0.029728652879702, 0.009631702754871],
      [0.029698963323395, 0.0097228636479],
      [0.029668994229134, 0.009813933025633],
      [0.029638745879, 0.009904910030891],
      [0.029608218557702, 0.009995793807363],
      [0.029577412552575, 0.010086583499618],
      [0.029546328153577, 0.010177278253107],
      [0.029514965653285, 0.010267877214177],
      [0.029483325346896, 0.010358379530076],
      [0.02945140753222, 0.010448784348962],
      [0.029419212509679, 0.010539090819911],
      [0.029386740582307, 0.010629298092923],
      [0.02935399205574, 0.010719405318933],
      [0.02932096723822, 0.010809411649818],
      [0.02928766644059, 0.010899316238403],
      [0.02925408997629, 0.010989118238474],
      [0.029220238161353, 0.011078816804778],
      [0.029186111314406, 0.011168411093039],
      [0.029151709756664, 0.011257900259961],
      [0.029117033811927, 0.011347283463239],
      [0.029082083806579, 0.011436559861563],
      [0.029046860069582, 0.01152572861463],
      [0.029011362932476, 0.01161478888315],
      [0.028975592729373, 0.011703739828853],
      [0.028939549796957, 0.0117925806145],
      [0.028903234474475, 0.011881310403886],
      [0.028866647103744, 0.011969928361855],
      [0.028829788029135, 0.012058433654299],
      [0.028792657597583, 0.012146825448172],
      [0.028755256158571, 0.012235102911499],
      [0.028717584064137, 0.012323265213377],
      [0.028679641668864, 0.01241131152399],
      [0.028641429329882, 0.012499241014612],
      [0.028602947406859, 0.012587052857618],
      [0.028564196262001, 0.012674746226488],
      [0.02852517626005, 0.012762320295819],
      [0.028485887768276, 0.012849774241331],
      [0.028446331156478, 0.012937107239875],
      [0.028406506796976, 0.013024318469437],
      [0.028366415064615, 0.013111407109155],
      [0.028326056336751, 0.013198372339315],
      [0.028285430993258, 0.013285213341368],
      [0.028244539416515, 0.013371929297933],
      [0.028203381991411, 0.013458519392807],
      [0.028161959105334, 0.013544982810971],
      [0.028120271148172, 0.013631318738598],
      [0.028078318512309, 0.013717526363062],
      [0.028036101592619, 0.013803604872943],
      [0.027993620786463, 0.013889553458039],
      [0.027950876493687, 0.013975371309367],
      [0.027907869116616, 0.014061057619178],
      [0.027864599060052, 0.014146611580959],
      [0.02782106673127, 0.014232032389445],
      [0.027777272540012, 0.014317319240622],
      [0.027733216898487, 0.014402471331737],
      [0.027688900221361, 0.014487487861307],
      [0.027644322925762, 0.014572368029123],
      [0.027599485431266, 0.014657111036262],
      [0.027554388159903, 0.01474171608509],
      [0.027509031536144, 0.014826182379271],
      [0.027463415986904, 0.014910509123778],
      [0.027417541941533, 0.014994695524894],
      [0.027371409831816, 0.015078740790225],
      [0.027325020091965, 0.015162644128704],
      [0.027278373158618, 0.015246404750603],
      [0.027231469470833, 0.015330021867534],
      [0.027184309470088, 0.01541349469246],
      [0.027136893600268, 0.015496822439704],
      [0.027089222307671, 0.015580004324954],
      [0.027041296040997, 0.015663039565269],
      [0.026993115251345, 0.015745927379091],
      [0.026944680392213, 0.015828666986247],
      [0.026895991919487, 0.015911257607961],
      [0.026847050291442, 0.015993698466859],
      [0.026797855968734, 0.016075988786976],
      [0.026748409414401, 0.016158127793763],
      [0.026698711093851, 0.016240114714099],
      [0.026648761474864, 0.016321948776289],
      [0.026598561027585, 0.016403629210082],
      [0.026548110224519, 0.016485155246669],
      [0.02649740954053, 0.016566526118696],
      [0.02644645945283, 0.016647741060271],
      [0.026395260440982, 0.016728799306966],
      [0.02634381298689, 0.016809700095831],
      [0.026292117574797, 0.016890442665397],
      [0.02624017469128, 0.016971026255683],
      [0.026187984825246, 0.017051450108208],
      [0.026135548467924, 0.01713171346599],
      [0.026082866112867, 0.01721181557356],
      [0.026029938255941, 0.017291755676967],
      [0.025976765395322, 0.017371533023784],
      [0.025923348031494, 0.017451146863116],
      [0.025869686667242, 0.017530596445607],
      [0.025815781807646, 0.017609881023449],
      [0.02576163396008, 0.017688999850383],
      [0.025707243634204, 0.017767952181715],
      [0.02565261134196, 0.017846737274313],
      [0.025597737597568, 0.017925354386623],
      [0.025542622917522, 0.018003802778671],
      [0.025487267820581, 0.018082081712071],
      [0.025431672827768, 0.018160190450031],
      [0.025375838462365, 0.018238128257362],
      [0.025319765249906, 0.018315894400484],
      [0.025263453718173, 0.018393488147432],
      [0.025206904397193, 0.018470908767865],
      [0.025150117819228, 0.01854815553307],
      [0.025093094518776, 0.018625227715971],
      [0.025035835032562, 0.018702124591135],
      [0.024978339899534, 0.01877884543478],
      [0.024920609660858, 0.01885538952478],
      [0.024862644859912, 0.018931756140672],
      [0.024804446042284, 0.019007944563666],
      [0.024746013755764, 0.019083954076646],
      [0.024687348550337, 0.019159783964183],
      [0.024628450978184, 0.019235433512536],
      [0.02456932159367, 0.019310902009663],
      [0.024509960953345, 0.019386188745225],
      [0.024450369615932, 0.019461293010596],
      [0.024390548142329, 0.019536214098866],
      [0.024330497095598, 0.019610951304848],
      [0.024270217040961, 0.019685503925087],
      [0.024209708545799, 0.019759871257867],
      [0.024148972179639, 0.019834052603212],
      [0.024088008514157, 0.019908047262901],
      [0.024026818123164, 0.019981854540467],
      [0.023965401582609, 0.020055473741208],
      [0.023903759470567, 0.020128904172192],
      [0.023841892367236, 0.020202145142264],
      [0.023779800854935, 0.020275195962052],
      [0.023717485518092, 0.020348055943974],
      [0.023654946943242, 0.020420724402244],
      [0.023592185719023, 0.020493200652878],
      [0.023529202436167, 0.020565484013703],
      [0.023465997687496, 0.020637573804361],
      [0.023402572067918, 0.020709469346314],
      [0.023338926174419, 0.020781169962854],
      [0.023275060606058, 0.020852674979108],
      [0.023210975963963, 0.020923983722044],
      [0.023146672851322, 0.020995095520475],
      [0.02308215187338, 0.021066009705072],
      [0.023017413637435, 0.021136725608363],
      [0.022952458752826, 0.021207242564742],
      [0.022887287830934, 0.021277559910478],
      [0.022821901485173, 0.021347676983716],
      [0.022756300330983, 0.021417593124488],
      [0.022690484985827, 0.021487307674717],
      [0.022624456069185, 0.021556819978223],
      [0.022558214202547, 0.021626129380729],
      [0.022491760009405, 0.021695235229869],
      [0.022425094115252, 0.021764136875192],
      [0.022358217147572, 0.021832833668171],
      [0.022291129735838, 0.021901324962204],
      [0.022223832511501, 0.021969610112625],
      [0.022156326107988, 0.022037688476709],
      [0.022088611160696, 0.022105559413676],
      [0.022020688306983, 0.022173222284699],
      [0.021952558186166, 0.022240676452909],
      [0.02188422143951, 0.022307921283403],
      [0.021815678710228, 0.022374956143245],
      [0.021746930643469, 0.022441780401478],
      [0.021677977886316, 0.022508393429127],
      [0.02160882108778, 0.022574794599206],
      [0.02153946089879, 0.022640983286719],
      [0.02146989797219, 0.022706958868676],
      [0.021400132962735, 0.022772720724087],
      [0.021330166527077, 0.022838268233979],
      [0.021259999323769, 0.022903600781391],
      [0.02118963201325, 0.022968717751391],
      [0.021119065257845, 0.023033618531071],
      [0.021048299721754, 0.023098302509561],
      [0.02097733607105, 0.023162769078031],
      [0.02090617497367, 0.023227017629698],
      [0.020834817099409, 0.023291047559828],
      [0.020763263119915, 0.023354858265748],
      [0.02069151370868, 0.023418449146848],
      [0.020619569541038, 0.023481819604585],
      [0.020547431294155, 0.023544969042494],
      [0.020475099647023, 0.023607896866186],
      [0.020402575280455, 0.023670602483363],
      [0.020329858877078, 0.023733085303813],
      [0.020256951121327, 0.023795344739427],
      [0.020183852699437, 0.023857380204193],
      [0.020110564299439, 0.023919191114211],
      [0.02003708661115, 0.023980776887692],
      [0.019963420326171, 0.024042136944968],
      [0.019889566137877, 0.024103270708495],
      [0.019815524741412, 0.024164177602859],
      [0.019741296833681, 0.024224857054779],
      [0.019666883113346, 0.02428530849312],
      [0.019592284280817, 0.024345531348888],
      [0.019517501038246, 0.024405525055242],
      [0.019442534089523, 0.0244652890475],
      [0.019367384140264, 0.024524822763141],
      [0.019292051897809, 0.024584125641809],
      [0.019216538071215, 0.024643197125323],
      [0.019140843371246, 0.024702036657681],
      [0.019064968510369, 0.024760643685063],
      [0.018988914202748, 0.024819017655836],
      [0.018912681164234, 0.024877158020562],
      [0.018836270112363, 0.024935064232003],
      [0.018759681766343, 0.024992735745123],
      [0.018682916847054, 0.025050172017095],
      [0.018605976077037, 0.025107372507308],
      [0.018528860180486, 0.025164336677369],
      [0.018451569883247, 0.02522106399111],
      [0.018374105912805, 0.025277553914591],
      [0.01829646899828, 0.025333805916107],
      [0.018218659870421, 0.025389819466194],
      [0.018140679261596, 0.02544559403763],
      [0.01806252790579, 0.025501129105445],
      [0.017984206538592, 0.02555642414692],
      [0.017905715897192, 0.025611478641598],
      [0.017827056720375, 0.025666292071285],
      [0.017748229748511, 0.025720863920056],
      [0.01766923572355, 0.02577519367426],
      [0.017590075389012, 0.025829280822525],
      [0.017510749489986, 0.025883124855762],
      [0.017431258773116, 0.02593672526717],
      [0.0173516039866, 0.025990081552242],
      [0.01727178588018, 0.026043193208768],
      [0.017191805205132, 0.026096059736841],
      [0.017111662714267, 0.026148680638861],
      [0.017031359161915, 0.026201055419541],
      [0.016950895303924, 0.026253183585908],
      [0.016870271897651, 0.026305064647313],
      [0.016789489701954, 0.026356698115431],
      [0.016708549477186, 0.026408083504269],
      [0.016627451985187, 0.026459220330167],
      [0.016546197989277, 0.026510108111806],
      [0.01646478825425, 0.026560746370212],
      [0.016383223546365, 0.026611134628757],
      [0.016301504633341, 0.026661272413168],
      [0.016219632284346, 0.02671115925153],
      [0.016137607269996, 0.026760794674288],
      [0.01605543036234, 0.026810178214254],
      [0.015973102334858, 0.026859309406613],
      [0.015890623962454, 0.026908187788922],
      [0.015807996021446, 0.026956812901119],
      [0.015725219289558, 0.027005184285527],
      [0.015642294545918, 0.027053301486856],
      [0.015559222571044, 0.027101164052208],
      [0.015476004146842, 0.027148771531083],
      [0.015392640056594, 0.02719612347538],
      [0.015309131084956, 0.027243219439406],
      [0.015225478017946, 0.027290058979875],
      [0.015141681642938, 0.027336641655915],
      [0.015057742748656, 0.027382967029073],
      [0.014973662125164, 0.027429034663317],
      [0.014889440563862, 0.02747484412504],
      [0.014805078857474, 0.027520394983066],
      [0.014720577800046, 0.027565686808654],
      [0.014635938186934, 0.027610719175499],
      [0.014551160814797, 0.02765549165974],
      [0.014466246481592, 0.02770000383996],
      [0.014381195986567, 0.027744255297195],
      [0.014296010130247, 0.027788245614933],
      [0.014210689714436, 0.02783197437912],
      [0.014125235542201, 0.027875441178165],
      [0.01403964841787, 0.027918645602941],
      [0.01395392914702, 0.027961587246792],
      [0.013868078536476, 0.028004265705534],
      [0.013782097394294, 0.028046680577462],
      [0.013695986529763, 0.028088831463351],
      [0.01360974675339, 0.028130717966461],
      [0.013523378876898, 0.02817233969254],
      [0.013436883713214, 0.028213696249828],
      [0.013350262076462, 0.028254787249062],
      [0.01326351478196, 0.028295612303478],
      [0.013176642646205, 0.028336171028814],
      [0.013089646486871, 0.028376463043317],
      [0.013002527122799, 0.028416487967743],
      [0.01291528537399, 0.028456245425361],
      [0.012827922061597, 0.02849573504196],
      [0.012740438007915, 0.028534956445849],
      [0.012652834036379, 0.028573909267859],
      [0.01256511097155, 0.028612593141354],
      [0.012477269639111, 0.028651007702224],
      [0.012389310865858, 0.028689152588899],
      [0.012301235479693, 0.028727027442343],
      [0.012213044309615, 0.028764631906065],
      [0.012124738185712, 0.028801965626115],
      [0.012036317939156, 0.028839028251097],
      [0.011947784402191, 0.028875819432161],
      [0.01185913840813, 0.028912338823015],
      [0.011770380791341, 0.028948586079925],
      [0.011681512387245, 0.028984560861718],
      [0.011592534032306, 0.029020262829785],
      [0.011503446564022, 0.029055691648087],
      [0.011414250820918, 0.029090846983152],
      [0.011324947642537, 0.029125728504087],
      [0.011235537869437, 0.029160335882573],
      [0.011146022343175, 0.029194668792871],
      [0.011056401906305, 0.029228726911828],
      [0.010966677402371, 0.029262509918876],
      [0.010876849675891, 0.029296017496036],
      [0.010786919572361, 0.029329249327922],
      [0.010696887938235, 0.029362205101743],
      [0.010606755620926, 0.029394884507308],
      [0.010516523468793, 0.029427287237024],
      [0.010426192331137, 0.029459412985906],
      [0.010335763058187, 0.029491261451573],
      [0.010245236501099, 0.029522832334255],
      [0.010154613511943, 0.029554125336796],
      [0.010063894943698, 0.029585140164654],
      [0.00997308165024, 0.029615876525905],
      [0.00988217448634, 0.029646334131247],
      [0.00979117430765, 0.029676512694001],
      [0.009700081970699, 0.029706411930116],
      [0.009608898332881, 0.029736031558168],
      [0.009517624252453, 0.029765371299366],
      [0.009426260588521, 0.029794430877553],
      [0.009334808201034, 0.02982321001921],
      [0.009243267950778, 0.029851708453456],
      [0.009151640699363, 0.029879925912053],
      [0.00905992730922, 0.029907862129408],
      [0.008968128643591, 0.029935516842573],
      [0.00887624556652, 0.029962889791254],
      [0.008784278942845, 0.029989980717805],
      [0.008692229638191, 0.030016789367235],
      [0.008600098518961, 0.030043315487212],
      [0.008507886452329, 0.030069558828062],
      [0.00841559430623, 0.030095519142772],
      [0.008323222949351, 0.030121196186994],
      [0.008230773251129, 0.030146589719046],
      [0.008138246081733, 0.030171699499915],
      [0.008045642312067, 0.030196525293257],
      [0.00795296281375, 0.030221066865402],
      [0.007860208459119, 0.030245323985357],
      [0.007767380121212, 0.030269296424803],
      [0.007674478673766, 0.030292983958103],
      [0.007581504991203, 0.030316386362302],
      [0.007488459948628, 0.030339503417126],
      [0.007395344421816, 0.030362334904989],
      [0.007302159287206, 0.030384880610993],
      [0.007208905421891, 0.030407140322928],
      [0.007115583703613, 0.030429113831278],
      [0.007022195010752, 0.03045080092922],
      [0.006928740222316, 0.030472201412626],
      [0.006835220217939, 0.030493315080068],
      [0.006741635877866, 0.030514141732814],
      [0.006647988082948, 0.030534681174838],
      [0.006554277714635, 0.030554933212813],
      [0.006460505654964, 0.030574897656119],
      [0.006366672786553, 0.030594574316845],
      [0.006272779992593, 0.030613963009786],
      [0.006178828156839, 0.030633063552447],
      [0.006084818163601, 0.030651875765048],
      [0.005990750897737, 0.03067039947052],
      [0.005896627244644, 0.030688634494512],
      [0.00580244809025, 0.030706580665388],
      [0.005708214321004, 0.030724237814232],
      [0.005613926823871, 0.030741605774849],
      [0.005519586486321, 0.030758684383764],
      [0.005425194196321, 0.030775473480228],
      [0.005330750842327, 0.030791972906214],
      [0.005236257313276, 0.030808182506425],
      [0.005141714498576, 0.030824102128288],
      [0.005047123288102, 0.030839731621963],
      [0.004952484572181, 0.030855070840339],
      [0.004857799241589, 0.030870119639036],
      [0.004763068187541, 0.030884877876411],
      [0.004668292301681, 0.030899345413553],
      [0.004573472476075, 0.030913522114288],
      [0.004478609603205, 0.03092740784518],
      [0.004383704575956, 0.03094100247553],
      [0.00428875828761, 0.030954305877381],
      [0.004193771631837, 0.030967317925516],
      [0.004098745502689, 0.030980038497461],
      [0.004003680794587, 0.030992467473486],
      [0.003908578402316, 0.031004604736602],
      [0.003813439221017, 0.031016450172571],
      [0.003718264146176, 0.031028003669899],
      [0.003623054073616, 0.031039265119839],
      [0.003527809899492, 0.031050234416394],
      [0.003432532520278, 0.031060911456318],
      [0.00333722283276, 0.031071296139114],
      [0.003241881734029, 0.031081388367037],
      [0.003146510121474, 0.031091188045095],
      [0.003051108892766, 0.031100695081051],
      [0.00295567894586, 0.031109909385419],
      [0.002860221178978, 0.031118830871473],
      [0.002764736490604, 0.031127459455239],
      [0.002669225779478, 0.031135795055501],
      [0.002573689944583, 0.031143837593803],
      [0.002478129885137, 0.031151586994444],
      [0.002382546500589, 0.031159043184484],
      [0.002286940690606, 0.031166206093743],
      [0.002191313355067, 0.0311730756548],
      [0.002095665394051, 0.031179651802998],
      [0.001999997707835, 0.031185934476438],
      [0.001904311196878, 0.031191923615985],
      [0.00180860676182, 0.031197619165268],
      [0.001712885303465, 0.031203021070678],
      [0.001617147722782, 0.03120812928137],
      [0.001521394920889, 0.031212943749264],
      [0.001425627799047, 0.031217464429043],
      [0.001329847258653, 0.031221691278159],
      [0.001234054201231, 0.031225624256825],
      [0.00113824952842, 0.031229263328024],
      [0.001042434141971, 0.031232608457502],
      [0.000946608943736, 0.031235659613775],
      [0.000850774835656, 0.031238416768124],
      [0.000754932719759, 0.031240879894597],
      [0.000659083498149, 0.03124304897001],
      [0.000563228072993, 0.031244923973948],
      [0.00046736734652, 0.031246504888762],
      [0.000371502221008, 0.031247791699571],
      [0.000275633598775, 0.031248784394264],
      [0.000179762382174, 0.031249482963498],
      [0.000083889473581, 0.031249887400697],
    ]

    const MDCT_TABLE_256 = [
      [0.088387931675923, 0.000271171628935],
      [0.088354655998507, 0.002440238387037],
      [0.08826815878011, 0.00460783523678],
      [0.088128492123423, 0.006772656498875],
      [0.087935740158418, 0.008933398165942],
      [0.08769001899167, 0.011088758687994],
      [0.087391476636423, 0.013237439756448],
      [0.087040292923427, 0.015378147086172],
      [0.086636679392621, 0.017509591195118],
      [0.086180879165703, 0.019630488181053],
      [0.085673166799686, 0.02173956049494],
      [0.085113848121515, 0.023835537710479],
      [0.084503260043847, 0.025917157289369],
      [0.08384177036211, 0.027983165341813],
      [0.083129777532952, 0.030032317381813],
      [0.08236771043423, 0.032063379076803],
      [0.081556028106671, 0.034075126991164],
      [0.080695219477356, 0.036066349323177],
      [0.079785803065216, 0.038035846634965],
      [0.078828326668693, 0.039982432574992],
      [0.077823367035766, 0.041904934592675],
      [0.07677152951654, 0.043802194644686],
      [0.075673447698606, 0.045673069892513],
      [0.07452978302539, 0.047516433390863],
      [0.073341224397728, 0.049331174766491],
      [0.072108487758894, 0.051116200887052],
      [0.070832315663343, 0.052870436519557],
      [0.069513476829429, 0.054592824978055],
      [0.068152765676348, 0.056282328760143],
      [0.06675100184562, 0.057937930171918],
      [0.065309029707361, 0.059558631940996],
      [0.063827717851668, 0.061143457817234],
      [0.062307958565413, 0.062691453160784],
      [0.060750667294763, 0.064201685517134],
      [0.059156782093749, 0.065673245178784],
      [0.057527263059216, 0.06710524573322],
      [0.055863091752499, 0.068496824596852],
      [0.054165270608165, 0.069847143534609],
      [0.052434822330188, 0.071155389164853],
      [0.050672789275903, 0.072420773449336],
      [0.048880232828135, 0.073642534167879],
      [0.047058232755862, 0.074819935377512],
      [0.045207886563797, 0.075952267855771],
      [0.043330308831298, 0.077038849527912],
      [0.041426630540984, 0.078079025877766],
      [0.039497998397473, 0.079072170341994],
      [0.037545574136653, 0.080017684687506],
      [0.035570533825892, 0.080914999371817],
      [0.033574067155622, 0.081763573886112],
      [0.031557376722714, 0.082562897080836],
      [0.029521677306074, 0.083312487473584],
      [0.027468195134911, 0.084011893539132],
      [0.025398167150101, 0.084660693981419],
      [0.023312840259098, 0.08525849798732],
      [0.021213470584847, 0.085804945462053],
      [0.019101322709138, 0.086299707246093],
      [0.016977668910873, 0.086742485313442],
      [0.014843788399692, 0.087133012951149],
      [0.012700966545425, 0.087471054919968],
      [0.01055049410383, 0.087756407596056],
      [0.008393666439096, 0.087988899093631],
      [0.006231782743558, 0.08816838936851],
      [0.004066145255116, 0.088294770302461],
      [0.001898058472816, 0.088367965768336],
    ]

    const MDCT_TABLE_1920 = [
      [0.032274858518097, 0.000013202404176],
      [0.032274642494505, 0.000118821372483],
      [0.032274080835421, 0.000224439068308],
      [0.03227317354686, 0.000330054360572],
      [0.032271920638538, 0.000435666118218],
      [0.032270322123873, 0.000541273210231],
      [0.032268378019984, 0.000646874505642],
      [0.032266088347691, 0.000752468873546],
      [0.032263453131514, 0.000858055183114],
      [0.032260472399674, 0.0009636323036],
      [0.032257146184092, 0.001069199104358],
      [0.03225347452039, 0.001174754454853],
      [0.032249457447888, 0.001280297224671],
      [0.032245095009606, 0.001385826283535],
      [0.032240387252262, 0.001491340501313],
      [0.032235334226272, 0.001596838748031],
      [0.03222993598575, 0.00170231989389],
      [0.032224192588507, 0.001807782809271],
      [0.03221810409605, 0.001913226364749],
      [0.032211670573582, 0.002018649431111],
      [0.03220489209, 0.002124050879359],
      [0.032197768717898, 0.002229429580728],
      [0.03219030053356, 0.002334784406698],
      [0.032182487616965, 0.002440114229003],
      [0.032174330051782, 0.002545417919644],
      [0.032165827925374, 0.002650694350905],
      [0.03215698132879, 0.002755942395358],
      [0.032147790356771, 0.002861160925883],
      [0.032138255107744, 0.002966348815672],
      [0.032128375683825, 0.00307150493825],
      [0.032118152190814, 0.003176628167476],
      [0.032107584738196, 0.003281717377568],
      [0.032096673439141, 0.003386771443102],
      [0.0320854184105, 0.003491789239036],
      [0.032073819772804, 0.003596769640711],
      [0.032061877650267, 0.003701711523874],
      [0.032049592170778, 0.00380661376468],
      [0.032036963465906, 0.003911475239711],
      [0.032023991670893, 0.004016294825985],
      [0.032010676924657, 0.004121071400967],
      [0.031997019369789, 0.004225803842586],
      [0.031983019152549, 0.004330491029241],
      [0.031968676422869, 0.004435131839816],
      [0.031953991334348, 0.004539725153692],
      [0.031938964044252, 0.004644269850758],
      [0.03192359471351, 0.004748764811426],
      [0.031907883506716, 0.004853208916638],
      [0.031891830592124, 0.004957601047881],
      [0.031875436141648, 0.0050619400872],
      [0.031858700330859, 0.005166224917208],
      [0.031841623338985, 0.005270454421097],
      [0.031824205348907, 0.005374627482653],
      [0.031806446547156, 0.005478742986267],
      [0.031788347123916, 0.005582799816945],
      [0.031769907273017, 0.005686796860323],
      [0.031751127191935, 0.005790733002674],
      [0.031732007081789, 0.005894607130928],
      [0.03171254714734, 0.005998418132675],
      [0.031692747596989, 0.006102164896182],
      [0.031672608642773, 0.006205846310406],
      [0.031652130500364, 0.006309461265002],
      [0.031631313389067, 0.006413008650337],
      [0.031610157531816, 0.006516487357501],
      [0.031588663155172, 0.006619896278321],
      [0.031566830489325, 0.00672323430537],
      [0.031544659768083, 0.006826500331981],
      [0.031522151228878, 0.006929693252258],
      [0.031499305112758, 0.007032811961088],
      [0.031476121664387, 0.007135855354151],
      [0.03145260113204, 0.007238822327937],
      [0.031428743767604, 0.007341711779751],
      [0.031404549826572, 0.00744452260773],
      [0.031380019568042, 0.007547253710853],
      [0.031355153254712, 0.007649903988952],
      [0.031329951152882, 0.007752472342725],
      [0.031304413532445, 0.007854957673748],
      [0.031278540666888, 0.007957358884484],
      [0.03125233283329, 0.0080596748783],
      [0.031225790312316, 0.008161904559473],
      [0.031198913388214, 0.008264046833205],
      [0.031171702348814, 0.008366100605636],
      [0.031144157485525, 0.008468064783849],
      [0.031116279093331, 0.008569938275893],
      [0.031088067470786, 0.008671719990782],
      [0.031059522920014, 0.008773408838517],
      [0.031030645746705, 0.008875003730092],
      [0.03100143626011, 0.008976503577507],
      [0.030971894773039, 0.00907790729378],
      [0.030942021601857, 0.009179213792959],
      [0.030911817066483, 0.009280421990133],
      [0.030881281490382, 0.009381530801444],
      [0.030850415200566, 0.009482539144097],
      [0.030819218527589, 0.009583445936373],
      [0.030787691805541, 0.009684250097643],
      [0.030755835372048, 0.009784950548375],
      [0.030723649568268, 0.009885546210147],
      [0.030691134738883, 0.009986036005661],
      [0.030658291232103, 0.010086418858753],
      [0.030625119399655, 0.010186693694402],
      [0.030591619596781, 0.010286859438745],
      [0.030557792182239, 0.010386915019088],
      [0.030523637518292, 0.010486859363916],
      [0.03048915597071, 0.010586691402906],
      [0.030454347908763, 0.010686410066936],
      [0.030419213705216, 0.010786014288099],
      [0.030383753736329, 0.010885502999714],
      [0.030347968381849, 0.010984875136338],
      [0.03031185802501, 0.011084129633775],
      [0.030275423052523, 0.011183265429088],
      [0.030238663854579, 0.011282281460612],
      [0.030201580824838, 0.011381176667967],
      [0.03016417436043, 0.011479949992062],
      [0.030126444861948, 0.011578600375117],
      [0.030088392733446, 0.011677126760663],
      [0.03005001838243, 0.011775528093563],
      [0.030011322219859, 0.011873803320018],
      [0.029972304660138, 0.011971951387578],
      [0.029932966121114, 0.012069971245157],
      [0.02989330702407, 0.012167861843041],
      [0.029853327793724, 0.012265622132901],
      [0.029813028858222, 0.012363251067801],
      [0.029772410649132, 0.012460747602215],
      [0.029731473601443, 0.012558110692033],
      [0.029690218153558, 0.012655339294575],
      [0.029648644747289, 0.0127524323686],
      [0.029606753827855, 0.01284938887432],
      [0.029564545843872, 0.012946207773407],
      [0.029522021247356, 0.013042888029011],
      [0.02947918049371, 0.013139428605762],
      [0.029436024041725, 0.013235828469789],
      [0.02939255235357, 0.013332086588727],
      [0.029348765894794, 0.013428201931728],
      [0.029304665134313, 0.013524173469475],
      [0.029260250544412, 0.013620000174189],
      [0.029215522600735, 0.013715681019643],
      [0.029170481782283, 0.013811214981173],
      [0.029125128571406, 0.013906601035686],
      [0.029079463453801, 0.014001838161674],
      [0.029033486918505, 0.014096925339225],
      [0.028987199457889, 0.014191861550031],
      [0.028940601567655, 0.014286645777401],
      [0.028893693746829, 0.014381277006273],
      [0.028846476497755, 0.014475754223221],
      [0.028798950326094, 0.014570076416472],
      [0.028751115740811, 0.01466424257591],
      [0.028702973254178, 0.014758251693091],
      [0.02865452338176, 0.014852102761253],
      [0.028605766642418, 0.014945794775326],
      [0.028556703558297, 0.015039326731945],
      [0.028507334654823, 0.015132697629457],
      [0.028457660460698, 0.015225906467935],
      [0.028407681507891, 0.015318952249187],
      [0.028357398331639, 0.015411833976768],
      [0.028306811470432, 0.015504550655988],
      [0.028255921466016, 0.015597101293927],
      [0.028204728863381, 0.015689484899442],
      [0.02815323421076, 0.015781700483179],
      [0.028101438059619, 0.015873747057582],
      [0.028049340964652, 0.015965623636907],
      [0.027996943483779, 0.016057329237229],
      [0.027944246178133, 0.016148862876456],
      [0.027891249612061, 0.016240223574335],
      [0.027837954353113, 0.016331410352467],
      [0.027784360972039, 0.016422422234315],
      [0.02773047004278, 0.016513258245214],
      [0.027676282142466, 0.016603917412384],
      [0.027621797851405, 0.016694398764938],
      [0.02756701775308, 0.016784701333894],
      [0.027511942434143, 0.016874824152183],
      [0.027456572484404, 0.016964766254662],
      [0.027400908496833, 0.017054526678124],
      [0.027344951067546, 0.017144104461307],
      [0.027288700795801, 0.017233498644904],
      [0.027232158283994, 0.017322708271577],
      [0.027175324137651, 0.01741173238596],
      [0.027118198965418, 0.017500570034678],
      [0.02706078337906, 0.017589220266351],
      [0.027003077993454, 0.017677682131607],
      [0.026945083426576, 0.017765954683088],
      [0.026886800299502, 0.017854036975468],
      [0.026828229236397, 0.017941928065456],
      [0.026769370864511, 0.018029627011808],
      [0.02671022581417, 0.01811713287534],
      [0.026650794718768, 0.018204444718934],
      [0.026591078214767, 0.018291561607551],
      [0.02653107694168, 0.018378482608238],
      [0.026470791542075, 0.018465206790142],
      [0.026410222661558, 0.018551733224515],
      [0.026349370948775, 0.01863806098473],
      [0.026288237055398, 0.018724189146286],
      [0.026226821636121, 0.018810116786819],
      [0.026165125348656, 0.018895842986112],
      [0.026103148853718, 0.018981366826109],
      [0.026040892815028, 0.019066687390916],
      [0.025978357899296, 0.019151803766819],
      [0.025915544776223, 0.01923671504229],
      [0.025852454118485, 0.019321420307998],
      [0.025789086601733, 0.019405918656817],
      [0.025725442904582, 0.019490209183837],
      [0.025661523708606, 0.019574290986376],
      [0.025597329698327, 0.019658163163984],
      [0.025532861561211, 0.019741824818458],
      [0.025468119987662, 0.019825275053848],
      [0.025403105671008, 0.01990851297647],
      [0.025337819307501, 0.019991537694913],
      [0.025272261596305, 0.020074348320047],
      [0.025206433239491, 0.020156943965039],
      [0.025140334942028, 0.020239323745355],
      [0.025073967411776, 0.020321486778774],
      [0.025007331359476, 0.020403432185395],
      [0.024940427498748, 0.02048515908765],
      [0.024873256546079, 0.020566666610309],
      [0.024805819220816, 0.020647953880491],
      [0.024738116245157, 0.020729020027676],
      [0.024670148344147, 0.020809864183709],
      [0.024601916245669, 0.020890485482816],
      [0.024533420680433, 0.020970883061607],
      [0.024464662381971, 0.021051056059087],
      [0.02439564208663, 0.02113100361667],
      [0.024326360533561, 0.021210724878181],
      [0.024256818464715, 0.021290218989868],
      [0.02418701662483, 0.021369485100415],
      [0.02411695576143, 0.021448522360944],
      [0.024046636624808, 0.02152732992503],
      [0.023976059968027, 0.021605906948708],
      [0.023905226546906, 0.02168425259048],
      [0.023834137120014, 0.021762366011328],
      [0.023762792448662, 0.02184024637472],
      [0.023691193296893, 0.02191789284662],
      [0.023619340431478, 0.021995304595495],
      [0.023547234621902, 0.02207248079233],
      [0.023474876640361, 0.022149420610628],
      [0.023402267261751, 0.022226123226426],
      [0.023329407263659, 0.0223025878183],
      [0.023256297426359, 0.022378813567377],
      [0.023182938532797, 0.022454799657339],
      [0.023109331368588, 0.022530545274437],
      [0.023035476722006, 0.022606049607496],
      [0.022961375383975, 0.022681311847926],
      [0.022887028148061, 0.022756331189727],
      [0.022812435810462, 0.022831106829504],
      [0.022737599170003, 0.022905637966469],
      [0.022662519028125, 0.022979923802453],
      [0.022587196188874, 0.023053963541915],
      [0.022511631458899, 0.02312775639195],
      [0.022435825647437, 0.023201301562294],
      [0.022359779566306, 0.023274598265338],
      [0.0222834940299, 0.023347645716133],
      [0.022206969855176, 0.0234204431324],
      [0.022130207861645, 0.023492989734537],
      [0.022053208871367, 0.023565284745628],
      [0.02197597370894, 0.023637327391451],
      [0.021898503201489, 0.023709116900488],
      [0.021820798178663, 0.023780652503931],
      [0.021742859472618, 0.023851933435691],
      [0.021664687918017, 0.023922958932406],
      [0.021586284352013, 0.023993728233451],
      [0.021507649614247, 0.024064240580942],
      [0.021428784546832, 0.02413449521975],
      [0.02134968999435, 0.024204491397504],
      [0.02127036680384, 0.0242742283646],
      [0.021190815824791, 0.024343705374213],
      [0.021111037909128, 0.024412921682298],
      [0.02103103391121, 0.024481876547605],
      [0.020950804687815, 0.024550569231683],
      [0.020870351098134, 0.024618998998889],
      [0.020789674003759, 0.024687165116394],
      [0.020708774268678, 0.024755066854194],
      [0.020627652759262, 0.024822703485116],
      [0.020546310344257, 0.024890074284826],
      [0.020464747894775, 0.024957178531837],
      [0.020382966284284, 0.025024015507516],
      [0.0203009663886, 0.025090584496093],
      [0.020218749085876, 0.025156884784668],
      [0.020136315256592, 0.025222915663218],
      [0.020053665783549, 0.025288676424605],
      [0.019970801551857, 0.025354166364584],
      [0.019887723448925, 0.025419384781811],
      [0.019804432364452, 0.025484330977848],
      [0.019720929190419, 0.025549004257175],
      [0.019637214821078, 0.025613403927192],
      [0.019553290152943, 0.02567752929823],
      [0.019469156084779, 0.025741379683559],
      [0.019384813517595, 0.025804954399392],
      [0.019300263354632, 0.025868252764895],
      [0.019215506501354, 0.025931274102193],
      [0.019130543865439, 0.025994017736379],
      [0.019045376356769, 0.026056482995518],
      [0.018960004887419, 0.026118669210657],
      [0.018874430371648, 0.026180575715833],
      [0.018788653725892, 0.026242201848076],
      [0.01870267586875, 0.026303546947421],
      [0.018616497720974, 0.026364610356909],
      [0.018530120205464, 0.026425391422602],
      [0.018443544247254, 0.026485889493583],
      [0.018356770773502, 0.026546103921965],
      [0.018269800713483, 0.026606034062902],
      [0.018182634998576, 0.026665679274589],
      [0.018095274562256, 0.026725038918274],
      [0.018007720340083, 0.026784112358263],
      [0.017919973269692, 0.026842898961926],
      [0.017832034290785, 0.026901398099707],
      [0.017743904345116, 0.026959609145127],
      [0.017655584376488, 0.027017531474792],
      [0.017567075330734, 0.027075164468401],
      [0.017478378155718, 0.02713250750875],
      [0.017389493801313, 0.027189559981742],
      [0.017300423219401, 0.027246321276391],
      [0.017211167363854, 0.027302790784828],
      [0.017121727190533, 0.02735896790231],
      [0.017032103657269, 0.027414852027226],
      [0.016942297723858, 0.027470442561102],
      [0.01685231035205, 0.027525738908608],
      [0.016762142505537, 0.027580740477564],
      [0.016671795149944, 0.027635446678948],
      [0.016581269252819, 0.0276898569269],
      [0.016490565783622, 0.02774397063873],
      [0.016399685713714, 0.027797787234924],
      [0.016308630016347, 0.027851306139149],
      [0.016217399666655, 0.02790452677826],
      [0.016125995641641, 0.027957448582309],
      [0.01603441892017, 0.028010070984544],
      [0.015942670482954, 0.028062393421421],
      [0.015850751312545, 0.02811441533261],
      [0.015758662393324, 0.028166136160998],
      [0.015666404711489, 0.028217555352697],
      [0.015573979255046, 0.028268672357047],
      [0.015481387013797, 0.028319486626627],
      [0.015388628979331, 0.028369997617257],
      [0.015295706145012, 0.028420204788004],
      [0.015202619505968, 0.028470107601191],
      [0.015109370059084, 0.028519705522399],
      [0.015015958802984, 0.028568998020472],
      [0.01492238673803, 0.028617984567529],
      [0.014828654866302, 0.028666664638963],
      [0.014734764191593, 0.028715037713449],
      [0.014640715719398, 0.028763103272951],
      [0.0145465104569, 0.028810860802724],
      [0.014452149412962, 0.028858309791325],
      [0.014357633598114, 0.028905449730613],
      [0.014262964024545, 0.028952280115756],
      [0.01416814170609, 0.02899880044524],
      [0.01407316765822, 0.029045010220868],
      [0.01397804289803, 0.029090908947771],
      [0.013882768444231, 0.029136496134411],
      [0.013787345317136, 0.029181771292585],
      [0.013691774538648, 0.029226733937433],
      [0.013596057132255, 0.029271383587441],
      [0.013500194123014, 0.029315719764447],
      [0.013404186537539, 0.029359741993647],
      [0.013308035403995, 0.029403449803598],
      [0.013211741752084, 0.029446842726223],
      [0.013115306613032, 0.02948992029682],
      [0.013018731019584, 0.029532682054063],
      [0.012922016005985, 0.029575127540008],
      [0.012825162607977, 0.029617256300097],
      [0.012728171862781, 0.029659067883165],
      [0.012631044809089, 0.029700561841444],
      [0.012533782487056, 0.029741737730567],
      [0.012436385938281, 0.029782595109573],
      [0.012338856205805, 0.029823133540913],
      [0.012241194334091, 0.029863352590452],
      [0.012143401369021, 0.029903251827477],
      [0.012045478357878, 0.029942830824699],
      [0.011947426349339, 0.029982089158259],
      [0.011849246393462, 0.030021026407731],
      [0.011750939541676, 0.030059642156129],
      [0.011652506846768, 0.030097935989909],
      [0.011553949362874, 0.030135907498976],
      [0.011455268145464, 0.030173556276684],
      [0.011356464251335, 0.030210881919845],
      [0.011257538738598, 0.030247884028732],
      [0.011158492666665, 0.030284562207083],
      [0.01105932709624, 0.030320916062102],
      [0.010960043089307, 0.03035694520447],
      [0.010860641709118, 0.030392649248343],
      [0.010761124020182, 0.030428027811361],
      [0.010661491088253, 0.030463080514646],
      [0.010561743980319, 0.030497806982812],
      [0.010461883764593, 0.030532206843968],
      [0.010361911510496, 0.030566279729717],
      [0.010261828288652, 0.030600025275167],
      [0.010161635170872, 0.030633443118931],
      [0.010061333230142, 0.030666532903129],
      [0.009960923540617, 0.030699294273397],
      [0.009860407177603, 0.030731726878888],
      [0.00975978521755, 0.030763830372273],
      [0.009659058738038, 0.03079560440975],
      [0.009558228817767, 0.030827048651045],
      [0.009457296536545, 0.030858162759415],
      [0.009356262975275, 0.030888946401653],
      [0.009255129215945, 0.030919399248091],
      [0.009153896341616, 0.030949520972603],
      [0.009052565436412, 0.030979311252611],
      [0.008951137585505, 0.031008769769084],
      [0.008849613875105, 0.031037896206544],
      [0.008747995392451, 0.031066690253072],
      [0.008646283225794, 0.031095151600306],
      [0.00854447846439, 0.031123279943448],
      [0.008442582198486, 0.031151074981266],
      [0.00834059551931, 0.031178536416098],
      [0.008238519519057, 0.031205663953853],
      [0.008136355290878, 0.031232457304017],
      [0.008034103928871, 0.031258916179656],
      [0.007931766528065, 0.031285040297416],
      [0.007829344184412, 0.031310829377528],
      [0.007726837994772, 0.031336283143813],
      [0.007624249056906, 0.03136140132368],
      [0.007521578469457, 0.031386183648135],
      [0.007418827331946, 0.031410629851778],
      [0.007315996744755, 0.031434739672811],
      [0.007213087809115, 0.031458512853036],
      [0.007110101627101, 0.031481949137863],
      [0.00700703930161, 0.031505048276306],
      [0.006903901936357, 0.031527810020993],
      [0.006800690635862, 0.031550234128164],
      [0.006697406505433, 0.031572320357675],
      [0.006594050651161, 0.031594068473],
      [0.006490624179905, 0.031615478241233],
      [0.006387128199278, 0.031636549433095],
      [0.006283563817639, 0.031657281822929],
      [0.00617993214408, 0.031677675188707],
      [0.006076234288412, 0.031697729312034],
      [0.005972471361157, 0.031717443978146],
      [0.005868644473532, 0.031736818975914],
      [0.00576475473744, 0.031755854097848],
      [0.005660803265456, 0.031774549140098],
      [0.005556791170816, 0.031792903902453],
      [0.005452719567407, 0.03181091818835],
      [0.005348589569753, 0.031828591804869],
      [0.005244402293001, 0.031845924562742],
      [0.005140158852914, 0.031862916276347],
      [0.005035860365855, 0.031879566763717],
      [0.004931507948778, 0.031895875846539],
      [0.004827102719212, 0.031911843350155],
      [0.004722645795254, 0.031927469103567],
      [0.004618138295554, 0.031942752939435],
      [0.004513581339303, 0.031957694694082],
      [0.004408976046222, 0.031972294207493],
      [0.004304323536549, 0.03198655132332],
      [0.00419962493103, 0.032000465888879],
      [0.004094881350902, 0.032014037755158],
      [0.003990093917884, 0.032027266776813],
      [0.003885263754166, 0.03204015281217],
      [0.003780391982394, 0.032052695723232],
      [0.003675479725661, 0.032064895375674],
      [0.003570528107494, 0.032076751638847],
      [0.003465538251839, 0.03208826438578],
      [0.003360511283053, 0.032099433493181],
      [0.003255448325892, 0.032110258841438],
      [0.003150350505494, 0.032120740314619],
      [0.003045218947373, 0.032130877800478],
      [0.002940054777404, 0.032140671190449],
      [0.00283485912181, 0.032150120379653],
      [0.002729633107153, 0.032159225266897],
      [0.002624377860318, 0.032167985754674],
      [0.002519094508504, 0.032176401749168],
      [0.002413784179212, 0.03218447316025],
      [0.002308448000231, 0.032192199901481],
      [0.002203087099626, 0.032199581890114],
      [0.002097702605728, 0.032206619047093],
      [0.001992295647121, 0.032213311297057],
      [0.001886867352628, 0.032219658568338],
      [0.001781418851302, 0.03222566079296],
      [0.00167595127241, 0.032231317906644],
      [0.001570465745428, 0.032236629848809],
      [0.001464963400018, 0.032241596562566],
      [0.001359445366028, 0.032246217994727],
      [0.00125391277347, 0.032250494095799],
      [0.001148366752513, 0.03225442481999],
      [0.001042808433471, 0.032258010125204],
      [0.000937238946789, 0.032261249973045],
      [0.00083165942303, 0.032264144328817],
      [0.000726070992868, 0.032266693161525],
      [0.000620474787068, 0.032268896443871],
      [0.000514871936481, 0.032270754152261],
      [0.00040926357203, 0.032272266266801],
      [0.000303650824695, 0.032273432771295],
      [0.000198034825504, 0.032274253653254],
      [0.000092416705518, 0.032274728903884],
    ]

    const MDCT_TABLE_240 = [
      [0.091286604111815, 0.000298735779793],
      [0.091247502481454, 0.002688238127538],
      [0.091145864370807, 0.005075898091152],
      [0.090981759437558, 0.00746007928776],
      [0.09075530015103, 0.009839147718664],
      [0.090466641715108, 0.012211472889198],
      [0.090115981961863, 0.014575428926191],
      [0.089703561215976, 0.016929395692256],
      [0.089229662130024, 0.019271759896156],
      [0.088694609490769, 0.02160091619847],
      [0.088098769996564, 0.02391526831181],
      [0.087442552006035, 0.026213230094844],
      [0.086726405258214, 0.028493226639351],
      [0.085950820564309, 0.030753695349588],
      [0.085116329471329, 0.032993087013213],
      [0.084223503897785, 0.035209866863042],
      [0.083272955741727, 0.037402515628894],
      [0.082265336461381, 0.039569530578832],
      [0.08120133662867, 0.041709426549053],
      [0.08008168545593, 0.043820736961749],
      [0.078907150296148, 0.045902014830227],
      [0.077678536117054, 0.047951833750597],
      [0.076396684949434, 0.049968788879362],
      [0.07506247531005, 0.051951497896226],
      [0.073676821599542, 0.053898601951466],
      [0.072240673475749, 0.055808766597225],
      [0.070755015202858, 0.057680682702068],
      [0.06922086497684, 0.059513067348201],
      [0.067639274227625, 0.061304664710718],
      [0.066011326898512, 0.063054246918278],
      [0.064338138703282, 0.06476061489463],
      [0.062620856361546, 0.066422599180399],
      [0.060860656812842, 0.068039060734572],
      [0.059058746410016, 0.069608891715145],
      [0.05721636009245, 0.071131016238378],
      [0.055334760539699, 0.072604391116154],
      [0.053415237306106, 0.07402800657093],
      [0.051459105937014, 0.075400886927784],
      [0.049467707067153, 0.076722091283096],
      [0.047442405501835, 0.077990714149396],
      [0.045384589281588, 0.079205886075941],
      [0.043295668730857, 0.080366774244592],
      [0.041177075491445, 0.081472583040586],
      [0.039030261541332, 0.08252255459781],
      [0.036856698199564, 0.083515969318206],
      [0.034657875117883, 0.084452146364948],
      [0.032435299259796, 0.085330444129049],
      [0.030190493867775, 0.086150260669096],
      [0.027924997419306, 0.086911034123781],
      [0.025640362572491, 0.087612243096981],
      [0.023338155101933, 0.088253407015092],
      [0.021019952825636, 0.08883408645639],
      [0.018687344523641, 0.089353883452193],
      [0.016341928849164, 0.089812441759604],
      [0.013985313232951, 0.090209447105664],
      [0.011619112781631, 0.09054462740274],
      [0.009244949170797, 0.090817752935],
      [0.006864449533597, 0.091028636515846],
      [0.004479245345574, 0.091177133616206],
      [0.002090971306534, 0.091263142463585],
    ]
    /*
     * AAC.js - Advanced Audio Coding decoder in JavaScript
     * Created by Devon Govett
     * Copyright (c) 2012, Official.fm Labs
     *
     * AAC.js is free software; you can redistribute it and/or modify it
     * under the terms of the GNU Lesser General Public License as
     * published by the Free Software Foundation; either version 3 of the
     * License, or (at your option) any later version.
     *
     * AAC.js is distributed in the hope that it will be useful, but WITHOUT
     * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
     * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General
     * Public License for more details.
     *
     * You should have received a copy of the GNU Lesser General Public
     * License along with this library.
     * If not, see <http://www.gnu.org/licenses/>.
     */

    /********************************************************************************
     * Sample offset into the window indicating the beginning of a scalefactor
     * window band
     *
     * scalefactor window band - term for scalefactor bands within a window,
     * given in Table 4.110 to Table 4.128.
     *
     * scalefactor band - a set of spectral coefficients which are scaled by one
     * scalefactor. In case of EIGHT_SHORT_SEQUENCE and grouping a scalefactor band
     * may contain several scalefactor window bands of corresponding frequency. For
     * all other window_sequences scalefactor bands and scalefactor window bands are
     * identical.
     *******************************************************************************/
    const SWB_OFFSET_1024_96 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      32,
      36,
      40,
      44,
      48,
      52,
      56,
      64,
      72,
      80,
      88,
      96,
      108,
      120,
      132,
      144,
      156,
      172,
      188,
      212,
      240,
      276,
      320,
      384,
      448,
      512,
      576,
      640,
      704,
      768,
      832,
      896,
      960,
      1024,
    ])

    const SWB_OFFSET_128_96 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      32,
      40,
      48,
      64,
      92,
      128,
    ])

    const SWB_OFFSET_1024_64 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      32,
      36,
      40,
      44,
      48,
      52,
      56,
      64,
      72,
      80,
      88,
      100,
      112,
      124,
      140,
      156,
      172,
      192,
      216,
      240,
      268,
      304,
      344,
      384,
      424,
      464,
      504,
      544,
      584,
      624,
      664,
      704,
      744,
      784,
      824,
      864,
      904,
      944,
      984,
      1024,
    ])

    const SWB_OFFSET_128_64 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      32,
      40,
      48,
      64,
      92,
      128,
    ])

    const SWB_OFFSET_1024_48 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      32,
      36,
      40,
      48,
      56,
      64,
      72,
      80,
      88,
      96,
      108,
      120,
      132,
      144,
      160,
      176,
      196,
      216,
      240,
      264,
      292,
      320,
      352,
      384,
      416,
      448,
      480,
      512,
      544,
      576,
      608,
      640,
      672,
      704,
      736,
      768,
      800,
      832,
      864,
      896,
      928,
      1024,
    ])

    const SWB_OFFSET_128_48 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      28,
      36,
      44,
      56,
      68,
      80,
      96,
      112,
      128,
    ])

    const SWB_OFFSET_1024_32 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      32,
      36,
      40,
      48,
      56,
      64,
      72,
      80,
      88,
      96,
      108,
      120,
      132,
      144,
      160,
      176,
      196,
      216,
      240,
      264,
      292,
      320,
      352,
      384,
      416,
      448,
      480,
      512,
      544,
      576,
      608,
      640,
      672,
      704,
      736,
      768,
      800,
      832,
      864,
      896,
      928,
      960,
      992,
      1024,
    ])

    const SWB_OFFSET_1024_24 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      32,
      36,
      40,
      44,
      52,
      60,
      68,
      76,
      84,
      92,
      100,
      108,
      116,
      124,
      136,
      148,
      160,
      172,
      188,
      204,
      220,
      240,
      260,
      284,
      308,
      336,
      364,
      396,
      432,
      468,
      508,
      552,
      600,
      652,
      704,
      768,
      832,
      896,
      960,
      1024,
    ])

    const SWB_OFFSET_128_24 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      36,
      44,
      52,
      64,
      76,
      92,
      108,
      128,
    ])

    const SWB_OFFSET_1024_16 = new Uint16Array([
      0,
      8,
      16,
      24,
      32,
      40,
      48,
      56,
      64,
      72,
      80,
      88,
      100,
      112,
      124,
      136,
      148,
      160,
      172,
      184,
      196,
      212,
      228,
      244,
      260,
      280,
      300,
      320,
      344,
      368,
      396,
      424,
      456,
      492,
      532,
      572,
      616,
      664,
      716,
      772,
      832,
      896,
      960,
      1024,
    ])

    const SWB_OFFSET_128_16 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      32,
      40,
      48,
      60,
      72,
      88,
      108,
      128,
    ])

    const SWB_OFFSET_1024_8 = new Uint16Array([
      0,
      12,
      24,
      36,
      48,
      60,
      72,
      84,
      96,
      108,
      120,
      132,
      144,
      156,
      172,
      188,
      204,
      220,
      236,
      252,
      268,
      288,
      308,
      328,
      348,
      372,
      396,
      420,
      448,
      476,
      508,
      544,
      580,
      620,
      664,
      712,
      764,
      820,
      880,
      944,
      1024,
    ])

    const SWB_OFFSET_128_8 = new Uint16Array([
      0,
      4,
      8,
      12,
      16,
      20,
      24,
      28,
      36,
      44,
      52,
      60,
      72,
      88,
      108,
      128,
    ])

    const SWB_OFFSET_1024 = [
      SWB_OFFSET_1024_96,
      SWB_OFFSET_1024_96,
      SWB_OFFSET_1024_64,
      SWB_OFFSET_1024_48,
      SWB_OFFSET_1024_48,
      SWB_OFFSET_1024_32,
      SWB_OFFSET_1024_24,
      SWB_OFFSET_1024_24,
      SWB_OFFSET_1024_16,
      SWB_OFFSET_1024_16,
      SWB_OFFSET_1024_16,
      SWB_OFFSET_1024_8,
    ]

    const SWB_OFFSET_128 = [
      SWB_OFFSET_128_96,
      SWB_OFFSET_128_96,
      SWB_OFFSET_128_64,
      SWB_OFFSET_128_48,
      SWB_OFFSET_128_48,
      SWB_OFFSET_128_48,
      SWB_OFFSET_128_24,
      SWB_OFFSET_128_24,
      SWB_OFFSET_128_16,
      SWB_OFFSET_128_16,
      SWB_OFFSET_128_16,
      SWB_OFFSET_128_8,
    ]

    const SWB_SHORT_WINDOW_COUNT = new Uint8Array([
      12,
      12,
      12,
      14,
      14,
      14,
      15,
      15,
      15,
      15,
      15,
      15,
    ])

    const SWB_LONG_WINDOW_COUNT = new Uint8Array([
      41,
      41,
      47,
      49,
      49,
      51,
      47,
      47,
      43,
      43,
      43,
      40,
    ])

    /*
     * Scalefactor lookup table
     */
    const SCALEFACTOR_TABLE = (function() {
      var table = new Float32Array(428)

      for (var i = 0; i < 428; i++) {
        table[i] = Math.pow(2, (i - 200) / 4)
      }

      return table
    })()

    /**
     * Inverse quantization lookup table
     */
    const IQ_TABLE = (function() {
      var table = new Float32Array(8191),
        four_thirds = 4 / 3

      for (var i = 0; i < 8191; i++) {
        table[i] = Math.pow(i, four_thirds)
      }

      return table
    })()

    var TNS = (function() {
      // Temporal Noise Shaping
      function TNS(config) {
        this.maxBands = TNS_MAX_BANDS_1024[config.sampleIndex]
        this.nFilt = new Int32Array(8)
        this.length = new Array(8)
        this.direction = new Array(8)
        this.order = new Array(8)
        this.coef = new Array(8)

        // Probably could allocate these as needed
        for (var w = 0; w < 8; w++) {
          this.length[w] = new Int32Array(4)
          this.direction[w] = new Array(4)
          this.order[w] = new Int32Array(4)
          this.coef[w] = new Array(4)

          for (var filt = 0; filt < 4; filt++) {
            this.coef[w][filt] = new Float32Array(TNS_MAX_ORDER)
          }
        }

        this.lpc = new Float32Array(TNS_MAX_ORDER)
        this.tmp = new Float32Array(TNS_MAX_ORDER)
      }

      const TNS_MAX_ORDER = 20,
        SHORT_BITS = [1, 4, 3],
        LONG_BITS = [2, 6, 5]

      const TNS_COEF_1_3 = [0.0, -0.43388373, 0.64278758, 0.34202015],
        TNS_COEF_0_3 = [
          0.0,
          -0.43388373,
          -0.7818315,
          -0.9749279,
          0.98480773,
          0.86602539,
          0.64278758,
          0.34202015,
        ],
        TNS_COEF_1_4 = [
          0.0,
          -0.2079117,
          -0.40673664,
          -0.58778524,
          0.67369562,
          0.52643216,
          0.36124167,
          0.18374951,
        ],
        TNS_COEF_0_4 = [
          0.0,
          -0.2079117,
          -0.40673664,
          -0.58778524,
          -0.74314481,
          -0.86602539,
          -0.95105654,
          -0.99452192,
          0.99573416,
          0.96182561,
          0.8951633,
          0.7980172,
          0.67369562,
          0.52643216,
          0.36124167,
          0.18374951,
        ],
        TNS_TABLES = [
          TNS_COEF_0_3,
          TNS_COEF_0_4,
          TNS_COEF_1_3,
          TNS_COEF_1_4,
        ]

      const TNS_MAX_BANDS_1024 = [
          31,
          31,
          34,
          40,
          42,
          51,
          46,
          46,
          42,
          42,
          42,
          39,
          39,
        ],
        TNS_MAX_BANDS_128 = [
          9,
          9,
          10,
          14,
          14,
          14,
          14,
          14,
          14,
          14,
          14,
          14,
          14,
        ]

      TNS.prototype.decode = function(stream, info) {
        var windowCount = info.windowCount,
          bits =
            info.windowSequence === ICStream.EIGHT_SHORT_SEQUENCE
              ? SHORT_BITS
              : LONG_BITS

        for (var w = 0; w < windowCount; w++) {
          if ((this.nFilt[w] = stream.read(bits[0]))) {
            var coefRes = stream.read(1),
              nFilt_w = this.nFilt[w],
              length_w = this.length[w],
              order_w = this.order[w],
              direction_w = this.direction[w],
              coef_w = this.coef[w]

            for (var filt = 0; filt < nFilt_w; filt++) {
              length_w[filt] = stream.read(bits[1])

              if ((order_w[filt] = stream.read(bits[2])) > 20)
                throw new Error(
                  "TNS filter out of range: " + order_w[filt]
                )

              if (order_w[filt]) {
                direction_w[filt] = !!stream.read(1)
                var coefCompress = stream.read(1),
                  coefLen = coefRes + 3 - coefCompress,
                  tmp = 2 * coefCompress + coefRes,
                  table = TNS_TABLES[tmp],
                  order_w_filt = order_w[filt],
                  coef_w_filt = coef_w[filt]

                for (var i = 0; i < order_w_filt; i++)
                  coef_w_filt[i] = table[stream.read(coefLen)]
              }
            }
          }
        }
      }

      TNS.prototype.process = function(ics, data, decode) {
        var mmm = Math.min(this.maxBands, ics.maxSFB),
          lpc = this.lpc,
          tmp = this.tmp,
          info = ics.info,
          windowCount = info.windowCount

        for (var w = 0; w < windowCount; w++) {
          var bottom = info.swbCount,
            nFilt_w = this.nFilt[w],
            length_w = this.length[w],
            order_w = this.order[w],
            coef_w = this.coef[w],
            direction_w = this.direction[w]

          for (var filt = 0; filt < nFilt_w; filt++) {
            var top = bottom,
              bottom = Math.max(0, tmp - length_w[filt]),
              order = order_w[filt]

            if (order === 0) continue

            // calculate lpc coefficients
            var autoc = coef_w[filt]
            for (var i = 0; i < order; i++) {
              var r = -autoc[i]
              lpc[i] = r

              for (var j = 0, len = (i + 1) >> 1; j < len; j++) {
                var f = lpc[j],
                  b = lpc[i - 1 - j]

                lpc[j] = f + r * b
                lpc[i - 1 - j] = b + r * f
              }
            }

            var start = info.swbOffsets[Math.min(bottom, mmm)],
              end = info.swbOffsets[Math.min(top, mmm)],
              size,
              inc = 1

            if ((size = end - start) <= 0) continue

            if (direction_w[filt]) {
              inc = -1
              start = end - 1
            }

            start += w * 128

            if (decode) {
              // ar filter
              for (var m = 0; m < size; m++, start += inc) {
                for (var i = 1; i <= Math.min(m, order); i++) {
                  data[start] -= data[start - i * inc] * lpc[i - 1]
                }
              }
            } else {
              // ma filter
              for (var m = 0; m < size; m++, start += inc) {
                tmp[0] = data[start]

                for (var i = 1; i <= Math.min(m, order); i++)
                  data[start] += tmp[i] * lpc[i - 1]

                for (var i = order; i > 0; i--) tmp[i] = tmp[i - 1]
              }
            }
          }
        }
      }

      return TNS
    })()

    window.AACDecoder = function() {
      // AAC profiles
      const AOT_AAC_MAIN = 1, // no
        AOT_AAC_LC = 2, // yes
        AOT_AAC_LTP = 4, // no
        AOT_ESCAPE = 31

      // Channel configurations
      const CHANNEL_CONFIG_NONE = 0,
        CHANNEL_CONFIG_MONO = 1,
        CHANNEL_CONFIG_STEREO = 2,
        CHANNEL_CONFIG_STEREO_PLUS_CENTER = 3,
        CHANNEL_CONFIG_STEREO_PLUS_CENTER_PLUS_REAR_MONO = 4,
        CHANNEL_CONFIG_FIVE = 5,
        CHANNEL_CONFIG_FIVE_PLUS_ONE = 6,
        CHANNEL_CONFIG_SEVEN_PLUS_ONE = 8

      this.setCookie = function(stream) {
        this.config = {}

        this.config.profile = stream.read(5)
        if (this.config.profile === AOT_ESCAPE)
          this.config.profile = 32 + stream.read(6)

        this.config.sampleIndex = stream.read(4)
        if (this.config.sampleIndex === 0x0f) {
          this.config.sampleRate = stream.read(24)
          for (var i = 0; i < SAMPLE_RATES.length; i++) {
            if (SAMPLE_RATES[i] === this.config.sampleRate) {
              this.config.sampleIndex = i
              break
            }
          }
        } else {
          this.config.sampleRate =
            SAMPLE_RATES[this.config.sampleIndex]
        }

        this.config.chanConfig = stream.read(4)
        this.format.channelsPerFrame = this.config.chanConfig // sometimes m4a files encode this wrong

        switch (this.config.profile) {
          case AOT_AAC_MAIN:
          case AOT_AAC_LC:
          case AOT_AAC_LTP:
            if (
              stream.read(1) // frameLengthFlag
            )
              throw new Error("frameLengthFlag not supported")

            this.config.frameLength = 1024

            if (
              stream.read(1) // dependsOnCoreCoder
            )
              stream.advance(14) // coreCoderDelay

            if (stream.read(1)) {
              // extensionFlag
              if (this.config.profile > 16) {
                // error resiliant profile
                this.config.sectionDataResilience = stream.read(1)
                this.config.scalefactorResilience = stream.read(1)
                this.config.spectralDataResilience = stream.read(1)
              }

              stream.advance(1)
            }

            if (this.config.chanConfig === CHANNEL_CONFIG_NONE) {
              stream.advance(4) // element_instance_tag
              throw new Error("PCE unimplemented")
            }

            break

          default:
            throw new Error(
              "AAC profile " + this.config.profile + " not supported."
            )
        }

        this.filter_bank = new FilterBank(
          false,
          this.config.chanConfig
        )
        this.ics = new ICStream(this.config)
        this.cpe = new CPEElement(this.config)
        this.cce = new CCEElement(this.config)
      }

      const SCE_ELEMENT = 0,
        CPE_ELEMENT = 1,
        CCE_ELEMENT = 2,
        LFE_ELEMENT = 3,
        DSE_ELEMENT = 4,
        PCE_ELEMENT = 5,
        FIL_ELEMENT = 6,
        END_ELEMENT = 7

      this.readADTSHeader = function(stream) {
        if (stream.read(12) !== 0xfff)
          throw new Error("Invalid ADTS header.")

        var ret = {}
        stream.advance(3) // mpeg version and layer
        var protectionAbsent = !!stream.read(1)

        ret.profile = stream.read(2) + 1
        ret.samplingIndex = stream.read(4)

        stream.advance(1) // private
        ret.chanConfig = stream.read(3)
        stream.advance(4) // original/copy, home, copywrite, and copywrite start

        ret.frameLength = stream.read(13)
        stream.advance(11) // fullness

        ret.numFrames = stream.read(2) + 1

        if (!protectionAbsent) stream.advance(16)

        return ret
      }

      // The main decoding function.
      this.readChunk = function(stream) {
        // check if there is an ADTS header, and read it if so
        if (stream.peek(12) === 0xfff) {
          var header = this.readADTSHeader(stream)
          if (!this.format) {
            this.format = {
              formatID: "aac ",
              sampleRate: SAMPLE_RATES[header.samplingIndex],
              channelsPerFrame: header.chanConfig,
              bitsPerChannel: 16,
              floatingPoint: true,
            }

            // generate a magic cookie from the ADTS header
            var cookie = new Uint8Array(2)
            cookie[0] =
              (header.profile << 3) |
              ((header.samplingIndex >> 1) & 7)
            cookie[1] =
              ((header.samplingIndex & 1) << 7) |
              (header.chanConfig << 3)
            this.setCookie(new BitReader(cookie))
          }
        }

        this.cces = []
        var elements = [],
          config = this.config,
          frameLength = config.frameLength,
          elementType = null

        while (
          (elementType = stream.read(3)) !== END_ELEMENT &&
          stream.index < stream.length * 8
        ) {
          var id = stream.read(4)

          switch (elementType) {
            // single channel and low frequency elements
            case SCE_ELEMENT:
            case LFE_ELEMENT:
              var ics = this.ics
              ics.id = id
              elements.push(ics)
              ics.decode(stream, config, false)
              break

            // channel pair element
            case CPE_ELEMENT:
              var cpe = this.cpe
              cpe.id = id
              elements.push(cpe)
              cpe.decode(stream, config)
              break

            // channel coupling element
            case CCE_ELEMENT:
              var cce = this.cce
              this.cces.push(cce)
              cce.decode(stream, config)
              break

            // data-stream element
            case DSE_ELEMENT:
              var align = stream.read(1),
                count = stream.read(8)

              if (count === 255) count += stream.read(8)

              if (align) stream.align()

              // skip for now...
              stream.advance(count * 8)
              break

            // program configuration element
            case PCE_ELEMENT:
              throw new Error("TODO: PCE_ELEMENT")
              break

            // filler element
            case FIL_ELEMENT:
              if (id === 15) id += stream.read(8) - 1

              // skip for now...
              stream.advance(id * 8)
              break

            default:
              throw new Error("Unknown element")
          }
        }

        stream.align()
        this.process(elements)

        // Interleave channels
        var data = this.data,
          channels = data.length,
          output = new Float32Array(frameLength * channels),
          j = 0

        for (var k = 0; k < frameLength; k++) {
          for (var i = 0; i < channels; i++) {
            output[j++] = data[i][k] / 32768
          }
        }

        return output
      }

      this.process = function(elements) {
        var channels = this.config.chanConfig

        // if (channels === 1 &&  psPresent)
        // TODO: sbrPresent (2)
        var mult = 1

        var len = mult * this.config.frameLength
        var data = (this.data = [])

        // Initialize channels
        for (var i = 0; i < channels; i++) {
          data[i] = new Float32Array(len)
        }

        var channel = 0
        for (
          var i = 0;
          i < elements.length && channel < channels;
          i++
        ) {
          var e = elements[i]

          if (e instanceof ICStream) {
            // SCE or LFE element
            channel += this.processSingle(e, channel)
          } else if (e instanceof CPEElement) {
            this.processPair(e, channel)
            channel += 2
          } else if (e instanceof CCEElement) {
            channel++
          } else {
            throw new Error("Unknown element found.")
          }
        }
      }

      this.processSingle = function(element, channel) {
        var profile = this.config.profile,
          info = element.info,
          data = element.data

        if (profile === AOT_AAC_MAIN)
          throw new Error("Main prediction unimplemented")

        if (profile === AOT_AAC_LTP)
          throw new Error("LTP prediction unimplemented")

        this.applyChannelCoupling(
          element,
          CCEElement.BEFORE_TNS,
          data,
          null
        )

        if (element.tnsPresent)
          element.tns.process(element, data, false)

        this.applyChannelCoupling(
          element,
          CCEElement.AFTER_TNS,
          data,
          null
        )

        // filterbank
        this.filter_bank.process(
          info,
          data,
          this.data[channel],
          channel
        )

        if (profile === AOT_AAC_LTP)
          throw new Error("LTP prediction unimplemented")

        this.applyChannelCoupling(
          element,
          CCEElement.AFTER_IMDCT,
          this.data[channel],
          null
        )

        if (element.gainPresent)
          throw new Error("Gain control not implemented")

        if (this.sbrPresent) throw new Error("SBR not implemented")

        return 1
      }

      this.processPair = function(element, channel) {
        var profile = this.config.profile,
          left = element.left,
          right = element.right,
          l_info = left.info,
          r_info = right.info,
          l_data = left.data,
          r_data = right.data

        // Mid-side stereo
        if (element.commonWindow && element.maskPresent)
          this.processMS(element, l_data, r_data)

        if (profile === AOT_AAC_MAIN)
          throw new Error("Main prediction unimplemented")

        // Intensity stereo
        this.processIS(element, l_data, r_data)

        if (profile === AOT_AAC_LTP)
          throw new Error("LTP prediction unimplemented")

        this.applyChannelCoupling(
          element,
          CCEElement.BEFORE_TNS,
          l_data,
          r_data
        )

        if (left.tnsPresent) left.tns.process(left, l_data, false)

        if (right.tnsPresent) right.tns.process(right, r_data, false)

        this.applyChannelCoupling(
          element,
          CCEElement.AFTER_TNS,
          l_data,
          r_data
        )

        // filterbank
        this.filter_bank.process(
          l_info,
          l_data,
          this.data[channel],
          channel
        )
        this.filter_bank.process(
          r_info,
          r_data,
          this.data[channel + 1],
          channel + 1
        )

        if (profile === AOT_AAC_LTP)
          throw new Error("LTP prediction unimplemented")

        this.applyChannelCoupling(
          element,
          CCEElement.AFTER_IMDCT,
          this.data[channel],
          this.data[channel + 1]
        )

        if (left.gainPresent)
          throw new Error("Gain control not implemented")

        if (right.gainPresent)
          throw new Error("Gain control not implemented")

        if (this.sbrPresent) throw new Error("SBR not implemented")
      }

      // Intensity stereo
      this.processIS = function(element, left, right) {
        var ics = element.right,
          info = ics.info,
          offsets = info.swbOffsets,
          windowGroups = info.groupCount,
          maxSFB = info.maxSFB,
          bandTypes = ics.bandTypes,
          sectEnd = ics.sectEnd,
          scaleFactors = ics.scaleFactors

        var idx = 0,
          groupOff = 0
        for (var g = 0; g < windowGroups; g++) {
          for (var i = 0; i < maxSFB; ) {
            var end = sectEnd[idx]

            if (
              bandTypes[idx] === ICStream.INTENSITY_BT ||
              bandTypes[idx] === ICStream.INTENSITY_BT2
            ) {
              for (; i < end; i++, idx++) {
                var c =
                  bandTypes[idx] === ICStream.INTENSITY_BT ? 1 : -1
                if (element.maskPresent)
                  c *= element.ms_used[idx] ? -1 : 1

                var scale = c * scaleFactors[idx]
                for (var w = 0; w < info.groupLength[g]; w++) {
                  var off = groupOff + w * 128 + offsets[i],
                    len = offsets[i + 1] - offsets[i]

                  for (var j = 0; j < len; j++) {
                    right[off + j] = left[off + j] * scale
                  }
                }
              }
            } else {
              idx += end - i
              i = end
            }
          }

          groupOff += info.groupLength[g] * 128
        }
      }

      // Mid-side stereo
      this.processMS = function(element, left, right) {
        var ics = element.left,
          info = ics.info,
          offsets = info.swbOffsets,
          windowGroups = info.groupCount,
          maxSFB = info.maxSFB,
          sfbCBl = ics.bandTypes,
          sfbCBr = element.right.bandTypes

        var groupOff = 0,
          idx = 0
        for (var g = 0; g < windowGroups; g++) {
          for (var i = 0; i < maxSFB; i++, idx++) {
            if (
              element.ms_used[idx] &&
              sfbCBl[idx] < ICStream.NOISE_BT &&
              sfbCBr[idx] < ICStream.NOISE_BT
            ) {
              for (var w = 0; w < info.groupLength[g]; w++) {
                var off = groupOff + w * 128 + offsets[i]
                for (
                  var j = 0;
                  j < offsets[i + 1] - offsets[i];
                  j++
                ) {
                  var t = left[off + j] - right[off + j]
                  left[off + j] += right[off + j]
                  right[off + j] = t
                }
              }
            }
          }
          groupOff += info.groupLength[g] * 128
        }
      }

      this.applyChannelCoupling = function(
        element,
        couplingPoint,
        data1,
        data2
      ) {
        var cces = this.cces,
          isChannelPair = element instanceof CPEElement,
          applyCoupling =
            couplingPoint === CCEElement.AFTER_IMDCT
              ? "applyIndependentCoupling"
              : "applyDependentCoupling"

        for (var i = 0; i < cces.length; i++) {
          var cce = cces[i],
            index = 0

          if (cce.couplingPoint === couplingPoint) {
            for (var c = 0; c < cce.coupledCount; c++) {
              var chSelect = cce.chSelect[c]
              if (
                cce.channelPair[c] === isChannelPair &&
                cce.idSelect[c] === element.id
              ) {
                if (chSelect !== 1) {
                  cce[applyCoupling](index, data1)
                  if (chSelect) index++
                }

                if (chSelect !== 2) cce[applyCoupling](index++, data2)
              } else {
                index += 1 + (chSelect === 3 ? 1 : 0)
              }
            }
          }
        }
      }
    }
  })()
  ;(function(window) {
    //JavaScript Audio Resampler
    //Copyright (C) 2011-2015 Grant Galitz
    //Released to Public Domain
    var Resampler = function(
      fromSampleRate,
      toSampleRate,
      channels,
      outputBufferSize,
      noReturn
    ) {
      this.fromSampleRate = fromSampleRate
      this.toSampleRate = toSampleRate
      this.channels = channels | 0
      this.outputBufferSize = outputBufferSize
      this.noReturn = !!noReturn
      this.initialize()
    }

    Resampler.prototype.initialize = function() {
      //Perform some checks:
      if (
        this.fromSampleRate > 0 &&
        this.toSampleRate > 0 &&
        this.channels > 0
      ) {
        if (this.fromSampleRate == this.toSampleRate) {
          //Setup a resampler bypass:
          this.resampler = this.bypassResampler //Resampler just returns what was passed through.
          this.ratioWeight = 1
        } else {
          this.ratioWeight = this.fromSampleRate / this.toSampleRate
          if (this.fromSampleRate < this.toSampleRate) {
            /*
            Use generic linear interpolation if upsampling,
            as linear interpolation produces a gradient that we want
            and works fine with two input sample points per output in this case.
          */
            this.compileLinearInterpolationFunction()
            this.lastWeight = 1
          } else {
            /*
            Custom resampler I wrote that doesn't skip samples
            like standard linear interpolation in high downsampling.
            This is more accurate than linear interpolation on downsampling.
          */
            this.compileMultiTapFunction()
            this.tailExists = false
            this.lastWeight = 0
          }
          this.initializeBuffers()
        }
      } else {
        throw new Error(
          "Invalid settings specified for the resampler."
        )
      }
    }
    Resampler.prototype.compileLinearInterpolationFunction = function() {
      var toCompile =
        "var bufferLength = buffer.length;\
  var outLength = this.outputBufferSize;\
  if ((bufferLength % " +
        this.channels +
        ") == 0) {\
    if (bufferLength > 0) {\
      var weight = this.lastWeight;\
      var firstWeight = 0;\
      var secondWeight = 0;\
      var sourceOffset = 0;\
      var outputOffset = 0;\
      var outputBuffer = this.outputBuffer;\
      for (; weight < 1; weight += " +
        this.ratioWeight +
        ") {\
        secondWeight = weight % 1;\
        firstWeight = 1 - secondWeight;"
      for (var channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "outputBuffer[outputOffset++] = (this.lastOutput[" +
          channel +
          "] * firstWeight) + (buffer[" +
          channel +
          "] * secondWeight);"
      }
      toCompile +=
        "}\
      weight -= 1;\
      for (bufferLength -= " +
        this.channels +
        ", sourceOffset = Math.floor(weight) * " +
        this.channels +
        "; outputOffset < outLength && sourceOffset < bufferLength;) {\
        secondWeight = weight % 1;\
        firstWeight = 1 - secondWeight;"
      for (var channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "outputBuffer[outputOffset++] = (buffer[sourceOffset" +
          (channel > 0 ? " + " + channel : "") +
          "] * firstWeight) + (buffer[sourceOffset + " +
          (this.channels + channel) +
          "] * secondWeight);"
      }
      toCompile +=
        "weight += " +
        this.ratioWeight +
        ";\
        sourceOffset = Math.floor(weight) * " +
        this.channels +
        ";\
      }"
      for (var channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "this.lastOutput[" + channel + "] = buffer[sourceOffset++];"
      }
      toCompile +=
        'this.lastWeight = weight % 1;\
      return this.bufferSlice(outputOffset);\
    }\
    else {\
      return (this.noReturn) ? 0 : [];\
    }\
  }\
  else {\
    throw(new Error("Buffer was of incorrect sample length."));\
  }'
      this.resample = Function("buffer", toCompile)
    }
    Resampler.prototype.compileMultiTapFunction = function() {
      var toCompile =
        "var bufferLength = buffer.length;\
  var outLength = this.outputBufferSize;\
  if ((bufferLength % " +
        this.channels +
        ") == 0) {\
    if (bufferLength > 0) {\
      var weight = 0;"
      for (var channel = 0; channel < this.channels; ++channel) {
        toCompile += "var output" + channel + " = 0;"
      }
      toCompile +=
        "var actualPosition = 0;\
      var amountToNext = 0;\
      var alreadyProcessedTail = !this.tailExists;\
      this.tailExists = false;\
      var outputBuffer = this.outputBuffer;\
      var outputOffset = 0;\
      var currentPosition = 0;\
      do {\
        if (alreadyProcessedTail) {\
          weight = " +
        this.ratioWeight +
        ";"
      for (channel = 0; channel < this.channels; ++channel) {
        toCompile += "output" + channel + " = 0;"
      }
      toCompile +=
        "}\
        else {\
          weight = this.lastWeight;"
      for (channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "output" + channel + " = this.lastOutput[" + channel + "];"
      }
      toCompile +=
        "alreadyProcessedTail = true;\
        }\
        while (weight > 0 && actualPosition < bufferLength) {\
          amountToNext = 1 + actualPosition - currentPosition;\
          if (weight >= amountToNext) {"
      for (channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "output" +
          channel +
          " += buffer[actualPosition++] * amountToNext;"
      }
      toCompile +=
        "currentPosition = actualPosition;\
            weight -= amountToNext;\
          }\
          else {"
      for (channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "output" +
          channel +
          " += buffer[actualPosition" +
          (channel > 0 ? " + " + channel : "") +
          "] * weight;"
      }
      toCompile +=
        "currentPosition += weight;\
            weight = 0;\
            break;\
          }\
        }\
        if (weight <= 0) {"
      for (channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "outputBuffer[outputOffset++] = output" +
          channel +
          " / " +
          this.ratioWeight +
          ";"
      }
      toCompile +=
        "}\
        else {\
          this.lastWeight = weight;"
      for (channel = 0; channel < this.channels; ++channel) {
        toCompile +=
          "this.lastOutput[" + channel + "] = output" + channel + ";"
      }
      toCompile +=
        'this.tailExists = true;\
          break;\
        }\
      } while (actualPosition < bufferLength && outputOffset < outLength);\
      return this.bufferSlice(outputOffset);\
    }\
    else {\
      return (this.noReturn) ? 0 : [];\
    }\
  }\
  else {\
    throw(new Error("Buffer was of incorrect sample length."));\
  }'
      this.resample = Function("buffer", toCompile)
    }
    Resampler.prototype.bypassResampler = function(buffer, upTo) {
      this.outputBuffer = buffer
      return this.bufferSlice(upTo)
    }
    Resampler.prototype.bufferSlice = function(sliceAmount) {
      if (this.noReturn) {
        //If we're going to access the properties directly from this object:
        return sliceAmount
      } else {
        //Typed array and normal array buffer section referencing:
        try {
          return this.outputBuffer.subarray(0, sliceAmount)
        } catch (error) {
          try {
            //Regular array pass:
            this.outputBuffer.length = sliceAmount
            return this.outputBuffer
          } catch (error) {
            //Nightly Firefox 4 used to have the subarray function named as slice:
            return this.outputBuffer.slice(0, sliceAmount)
          }
        }
      }
    }
    Resampler.prototype.initializeBuffers = function() {
      //Initialize the internal buffer:
      try {
        this.outputBuffer = new Float32Array(this.outputBufferSize)
        this.lastOutput = new Float32Array(this.channels)
      } catch (error) {
        this.outputBuffer = []
        this.lastOutput = []
      }
    }

    window.Resampler = Resampler
  })(window)
  ;(function(window) {
    "use strict"

    // jsmpeg by Dominic Szablewski - phoboslab.org, github.com/phoboslab
    //
    // Consider this to be under MIT license. It's largely based an an Open Source
    // Decoder for Java under GPL, while I looked at another Decoder from Nokia
    // (under no particular license?) for certain aspects.
    // I'm not sure if this work is "derivative" enough to have a different license
    // but then again, who still cares about MPEG1?
    //
    // Based on "Java MPEG-1 Video Decoder and Player" by Korandi Zoltan:
    // http://sourceforge.net/projects/javampeg1video/
    //
    // Inspired by "MPEG Decoder in Java ME" by Nokia:
    // http://www.developer.nokia.com/Community/Wiki/MPEG_decoder_in_Java_ME

    var requestAnimFrame = (function() {
      return (
        window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        function(callback) {
          window.setTimeout(callback, 1000 / 60)
        }
      )
    })()

    var jsmpeg = (window.jsmpeg = function(url, opts) {
      opts = opts || {}
      this.benchmark = !!opts.benchmark
      this.canvas = null
      this.autoplay = !!opts.autoplay
      this.loop = !!opts.loop
      this.seekable = !!opts.seekable
      this.externalLoadCallback = opts.onload || null
      this.externalDecodeCallback = opts.ondecodeframe || null
      this.externalFinishedCallback = opts.onfinished || null
      this.unlockAudioElement = opts.unlockAudio || null

      this.customIntraQuantMatrix = new Uint8Array(64)
      this.customNonIntraQuantMatrix = new Uint8Array(64)
      this.blockData = new Int32Array(64)
      this.zeroBlockData = new Int32Array(64)
      this.fillArray(this.zeroBlockData, 0)

      // use WebGL for YCbCrToRGBA conversion if possible (much faster)
      if (!opts.forceCanvas2D && this.initWebGL()) {
        this.renderFrame = this.renderFrameGL
      } else {
        this.canvasContext = this.canvas.getContext("2d")
        this.renderFrame = this.renderFrame2D
      }

      if (url instanceof WebSocket) {
        this.client = url
        this.client.onopen = this.initSocketClient.bind(this)
      } else {
        this.load(url)
      }
    })

    // ----------------------------------------------------------------------------
    // Streaming over WebSockets

    jsmpeg.prototype.waitForIntraFrame = true
    jsmpeg.prototype.socketBufferSize = 512 * 1024 // 512kb each

    jsmpeg.prototype.initSocketClient = function(client) {
      this.buffer = new BitReader(
        new ArrayBuffer(this.socketBufferSize)
      )
      this.buffer.writePos = 0

      console.log(this.address, "initSocketClient");

      this.client.binaryType = "arraybuffer"
      this.client.onmessage = this.receiveSocketMessage.bind(this)
    }

    jsmpeg.prototype.decodeSocketHeader = function(data) {
      // Custom header sent to all newly connected clients when streaming
      // over websockets:
      // struct { char magic[4] = "jsmp"; unsigned short width, height; };
      if (
        data[0] == SOCKET_MAGIC_BYTES.charCodeAt(0) &&
        data[1] == SOCKET_MAGIC_BYTES.charCodeAt(1) &&
        data[2] == SOCKET_MAGIC_BYTES.charCodeAt(2) &&
        data[3] == SOCKET_MAGIC_BYTES.charCodeAt(3)
      ) {
        this.width = data[4] * 256 + data[5]
        this.height = data[6] * 256 + data[7]
        console.log("this.width", this.width);
        console.log("this.height", this.height);
        this.initBuffers()
      }
    }

    jsmpeg.prototype.scriptProcessorSamples = 1024
    jsmpeg.prototype.initWebAudio = function() {
      if (this.audioScriptProc) {
        this.audioScriptProc.disconnect()
      }
      this.audioScriptProc = this.audioCtx.createScriptProcessor
        ? this.audioCtx.createScriptProcessor(
            this.scriptProcessorSamples,
            1,
            1
          )
        : this.audioCtx.createJavaScriptNode(
            this.scriptProcessorSamples,
            1,
            1
          )

      this.audioScriptProc.onaudioprocess = this.fillAudioBuffer.bind(
        this
      )
      this.audioScriptProc.connect(this.audioCtx.destination)
    }

    jsmpeg.prototype.webAudioUnlocked = false
    jsmpeg.prototype.unlockWebAudio = function() {
      if (this.webAudioUnlocked) {
        return
      }

      var buffer = this.audioCtx.createBuffer(1, 22050, 44100)
      var source = this.audioCtx.createBufferSource()
      source.buffer = buffer
      source.connect(this.audioCtx.destination)
      source.noteOn(0)

      var that = this
      setTimeout(function() {
        if (
          source.playbackState === source.PLAYING_STATE ||
          source.playbackState === source.FINISHED_STATE
        ) {
          if (that.unlockAudioElement) {
            that.unlockAudioElement.style.display = "none"
          }
          that.webAudioUnlocked = true
          that.initWebAudio()
        }
      }, 100)
    }

    jsmpeg.prototype.fillPos = 0
    jsmpeg.prototype.fillAudioBuffer = function(ev) {
      var source = this.decodedAudioBuffer
      var dest = ev.outputBuffer.getChannelData(0)

      if (source.length < dest.length) {
        for (var i = 0; i < dest.length; i++) {
          dest[i] = 0
        }
        //    console.log('audio buffer starved', source.length)
        return
      }

      var start = 0
      if (source.length > dest.length * 3) {
        start = source.length - dest.length * 2
        //    console.log('audio buffer overflowed', source.length, start);
      }

      dest.set(source.subarray(start, dest.length))
      this.decodedAudioBuffer = this.decodedAudioBuffer.subarray(
        start + dest.length
      )
    }

    jsmpeg.prototype.audioScriptProc = null
    jsmpeg.prototype.decodedAudioBuffer = new Float32Array()

    jsmpeg.prototype.concatFloat32Arrays = function(a1, a2) {
      var tmp = new Float32Array(a1.length + a2.length)
      tmp.set(a1, 0)
      tmp.set(a2, a1.length)
      return tmp
    }

    jsmpeg.prototype.currentPacketType = 0
    jsmpeg.prototype.currentPacketLength = 0
    jsmpeg.prototype.receiveSocketMessage = function(event) {
      var messageData = new Uint8Array(event.data)

      if (!this.sequenceStarted) {
        this.decodeSocketHeader(messageData)
        this.aacDecoder = new window.AACDecoder()
        return
      }

      if (
        messageData.length >= 8 &&
        messageData[0] === 0x00 &&
        messageData[1] === 0x00 &&
        messageData[2] === 0x01 &&
        (messageData[3] === START_PACKET_VIDEO ||
          messageData[3] === START_PACKET_AUDIO)
      ) {
        this.currentPacketType = messageData[3]
        this.currentPacketLength =
          (messageData[4] << 24) +
          (messageData[5] << 16) +
          (messageData[6] << 8) +
          messageData[7]
      }
      if (this.currentPacketType == START_PACKET_VIDEO) {
        this.buffer.bytes.set(messageData, this.buffer.writePos)
        this.buffer.writePos += messageData.length

        if (this.buffer.writePos >= this.currentPacketLength) {
          if (
            this.findStartCode(START_PICTURE) == BitReader.NOT_FOUND
          ) {
            return
          }
          this.decodePicture()
          this.buffer.index = 0
          this.buffer.writePos = 0
        }
      } else if (this.currentPacketType == START_PACKET_AUDIO) {
      }
    }

    jsmpeg.prototype.scheduleDecoding = function() {
      this.decodePicture()
      this.currentPictureDecoded = true
    }

    // ----------------------------------------------------------------------------
    // Recording from WebSockets

    jsmpeg.prototype.isRecording = false
    jsmpeg.prototype.recorderWaitForIntraFrame = false
    jsmpeg.prototype.recordedFrames = 0
    jsmpeg.prototype.recordedSize = 0
    jsmpeg.prototype.didStartRecordingCallback = null

    jsmpeg.prototype.recordBuffers = []

    jsmpeg.prototype.canRecord = function() {
      return this.client && this.client.readyState == this.client.OPEN
    }

    jsmpeg.prototype.startRecording = function(callback) {
      if (!this.canRecord()) {
        return
      }

      // Discard old buffers and set for recording
      this.discardRecordBuffers()
      this.isRecording = true
      this.recorderWaitForIntraFrame = true
      this.didStartRecordingCallback = callback || null

      this.recordedFrames = 0
      this.recordedSize = 0

      // Fudge a simple Sequence Header for the MPEG file

      // 3 bytes width & height, 12 bits each
      var wh1 = this.width >> 4,
        wh2 = ((this.width & 0xf) << 4) | (this.height >> 8),
        wh3 = this.height & 0xff

      this.recordBuffers.push(
        new Uint8Array([
          0x00,
          0x00,
          0x01,
          0xb3, // Sequence Start Code
          wh1,
          wh2,
          wh3, // Width & height
          0x13, // aspect ratio & framerate
          0xff,
          0xff,
          0xe1,
          0x58, // Meh. Bitrate and other boring stuff
          0x00,
          0x00,
          0x01,
          0xb8,
          0x00,
          0x08,
          0x00, // GOP
        ])
      )
    }

    jsmpeg.prototype.recordFrame = function() {
      if (!this.isRecording) {
        return
      }

      if (this.recorderWaitForIntraFrame) {
        // Not an intra frame? Exit.
        if (this.pictureCodingType != PICTURE_TYPE_I) {
          return
        }

        // Start recording!
        this.recorderWaitForIntraFrame = false
        if (this.didStartRecordingCallback) {
          this.didStartRecordingCallback(this)
        }
      }

      // Copy the actual subrange for the current picture into a new Buffer
      this.recordBuffers.push(
        new Uint8Array(
          this.buffer.bytes.subarray(8, this.buffer.writePos)
        )
      )

      this.recordedFrames++
      this.recordedSize += this.buffer.writePos
    }

    jsmpeg.prototype.discardRecordBuffers = function() {
      this.recordBuffers = []
      this.recordedFrames = 0
    }

    jsmpeg.prototype.stopRecording = function() {
      var blob = new Blob(this.recordBuffers, { type: "video/mpeg" })
      this.discardRecordBuffers()
      this.isRecording = false
      return blob
    }

    // ----------------------------------------------------------------------------
    // Loading via Ajax

    jsmpeg.prototype.intraFrames = []
    jsmpeg.prototype.currentFrame = -1
    jsmpeg.prototype.currentTime = 0
    jsmpeg.prototype.frameCount = 0
    jsmpeg.prototype.duration = 0

    jsmpeg.prototype.load = function(url) {
      this.url = url

      var request = new XMLHttpRequest()
      var that = this
      request.onreadystatechange = function() {
        if (
          request.readyState == request.DONE &&
          request.status == 200
        ) {
          that.loadCallback(request.response)
        }
      }

      request.onprogress = this.gl
        ? this.updateLoaderGL.bind(this)
        : this.updateLoader2D.bind(this)

      request.open("GET", url)
      request.responseType = "arraybuffer"
      request.send()
    }

    jsmpeg.prototype.updateLoader2D = function(ev) {
      var p = ev.loaded / ev.total,
        w = this.canvas.width,
        h = this.canvas.height,
        ctx = this.canvasContext

      ctx.fillStyle = "#222"
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, h - h * p, w, h * p)
    }

    jsmpeg.prototype.updateLoaderGL = function(ev) {
      var gl = this.gl
      gl.uniform1f(
        gl.getUniformLocation(this.loadingProgram, "loaded"),
        ev.loaded / ev.total
      )
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    jsmpeg.prototype.loadCallback = function(file) {
      this.buffer = new BitReader(file)

      if (this.seekable) {
        this.collectIntraFrames()
        this.buffer.index = 0
      }

      this.findStartCode(START_SEQUENCE)
      this.firstSequenceHeader = this.buffer.index
      this.decodeSequenceHeader()

      // Calculate the duration. This only works if the video is seekable and we have a frame count
      this.duration = this.frameCount / this.pictureRate

      // Load the first frame
      this.nextFrame()

      if (this.autoplay) {
        this.play()
      }

      if (this.externalLoadCallback) {
        this.externalLoadCallback(this)
      }
    }

    jsmpeg.prototype.collectIntraFrames = function() {
      // Loop through the whole buffer and collect all intraFrames to build our seek index.
      // We also keep track of total frame count here
      var frame
      for (
        frame = 0;
        this.findStartCode(START_PICTURE) !== BitReader.NOT_FOUND;
        frame++
      ) {
        // Check if the found picture is an intra frame and remember the position
        this.buffer.advance(10) // skip temporalReference
        if (this.buffer.getBits(3) == PICTURE_TYPE_I) {
          // Remember index 13 bits back, before temporalReference and picture type
          this.intraFrames.push({
            frame: frame,
            index: this.buffer.index - 13,
          })
        }
      }

      this.frameCount = frame
    }

    jsmpeg.prototype.seekToFrame = function(seekFrame, seekExact) {
      if (
        seekFrame < 0 ||
        seekFrame >= this.frameCount ||
        !this.intraFrames.length
      ) {
        return false
      }

      // Find the last intra frame before or equal to seek frame
      var target = null
      for (
        var i = 0;
        i < this.intraFrames.length &&
        this.intraFrames[i].frame <= seekFrame;
        i++
      ) {
        target = this.intraFrames[i]
      }

      this.buffer.index = target.index
      this.currentFrame = target.frame - 1

      // If we're seeking to the exact frame, we may have to decode some more frames before
      // the one we want
      if (seekExact) {
        for (var frame = target.frame; frame < seekFrame; frame++) {
          this.decodePicture(DECODE_SKIP_OUTPUT)
          this.findStartCode(START_PICTURE)
        }
        this.currentFrame = seekFrame - 1
      }

      // Decode and display the picture we have seeked to
      this.decodePicture()
      return true
    }

    jsmpeg.prototype.seekToTime = function(time, seekExact) {
      this.seekToFrame((time * this.pictureRate) | 0, seekExact)
    }

    jsmpeg.prototype.play = function(file) {
      if (this.playing) {
        return
      }
      this.targetTime = this.now()
      this.playing = true
      this.scheduleNextFrame()
    }

    jsmpeg.prototype.pause = function(file) {
      this.playing = false
    }

    jsmpeg.prototype.stop = function(file) {
      this.currentFrame = -1
      if (this.buffer) {
        this.buffer.index = this.firstSequenceHeader
      }
      this.playing = false
      if (this.client) {
        this.client.close()
        this.client = null
      }
    }

    // ----------------------------------------------------------------------------
    // Utilities

    jsmpeg.prototype.readCode = function(codeTable) {
      var state = 0
      do {
        state = codeTable[state + this.buffer.getBits(1)]
      } while (state >= 0 && codeTable[state] != 0)
      return codeTable[state + 2]
    }

    jsmpeg.prototype.findStartCode = function(code) {
      var current = 0
      while (true) {
        current = this.buffer.findNextMPEGStartCode()
        if (current == code || current == BitReader.NOT_FOUND) {
          return current
        }
      }
      return BitReader.NOT_FOUND
    }

    jsmpeg.prototype.fillArray = function(a, value) {
      for (var i = 0, length = a.length; i < length; i++) {
        a[i] = value
      }
    }

    // ----------------------------------------------------------------------------
    // Sequence Layer

    jsmpeg.prototype.pictureRate = 30
    jsmpeg.prototype.lateTime = 0
    jsmpeg.prototype.firstSequenceHeader = 0
    jsmpeg.prototype.targetTime = 0

    jsmpeg.prototype.benchmark = false
    jsmpeg.prototype.benchFrame = 0
    jsmpeg.prototype.benchDecodeTimes = 0
    jsmpeg.prototype.benchAvgFrameTime = 0

    jsmpeg.prototype.now = function() {
      return window.performance
        ? window.performance.now()
        : Date.now()
    }

    jsmpeg.prototype.nextFrame = function() {
      if (!this.buffer) {
        return
      }

      var frameStart = this.now()
      while (true) {
        var code = this.buffer.findNextMPEGStartCode()

        if (code == START_SEQUENCE) {
          this.decodeSequenceHeader()
        } else if (code == START_PICTURE) {
          if (this.playing) {
            this.scheduleNextFrame()
          }
          this.decodePicture()
          this.benchDecodeTimes += this.now() - frameStart
          return this.canvas
        } else if (code == BitReader.NOT_FOUND) {
          this.stop() // Jump back to the beginning

          if (this.externalFinishedCallback) {
            this.externalFinishedCallback(this)
          }

          // Only loop if we found a sequence header
          if (this.loop && this.sequenceStarted) {
            this.play()
          }
          return null
        } else {
          // ignore (GROUP, USER_DATA, EXTENSION, SLICES...)
        }
      }
    }

    jsmpeg.prototype.scheduleNextFrame = function() {
      this.lateTime = this.now() - this.targetTime
      var wait = Math.max(0, 1000 / this.pictureRate - this.lateTime)
      this.targetTime = this.now() + wait

      if (this.benchmark) {
        this.benchFrame++
        if (this.benchFrame >= 120) {
          this.benchAvgFrameTime =
            this.benchDecodeTimes / this.benchFrame
          this.benchFrame = 0
          this.benchDecodeTimes = 0
          if (window.console) {
            console.log(
              "Average time per frame:",
              this.benchAvgFrameTime,
              "ms"
            )
          }
        }
        setTimeout(this.nextFrame.bind(this), 0)
      } else if (wait < 18) {
        this.scheduleAnimation()
      } else {
        setTimeout(this.scheduleAnimation.bind(this), wait)
      }
    }

    jsmpeg.prototype.scheduleAnimation = function() {
      requestAnimFrame(this.nextFrame.bind(this), this.canvas)
    }

    jsmpeg.prototype.decodeSequenceHeader = function() {
      this.width = this.buffer.getBits(12)
      this.height = this.buffer.getBits(12)
      this.buffer.advance(4) // skip pixel aspect ratio
      this.pictureRate = PICTURE_RATE[this.buffer.getBits(4)]
      this.buffer.advance(18 + 1 + 10 + 1) // skip bitRate, marker, bufferSize and constrained bit

      this.initBuffers()

      if (this.buffer.getBits(1)) {
        // load custom intra quant matrix?
        for (var i = 0; i < 64; i++) {
          this.customIntraQuantMatrix[
            ZIG_ZAG[i]
          ] = this.buffer.getBits(8)
        }
        this.intraQuantMatrix = this.customIntraQuantMatrix
      }

      if (this.buffer.getBits(1)) {
        // load custom non intra quant matrix?
        for (var i = 0; i < 64; i++) {
          this.customNonIntraQuantMatrix[
            ZIG_ZAG[i]
          ] = this.buffer.getBits(8)
        }
        this.nonIntraQuantMatrix = this.customNonIntraQuantMatrix
      }
    }

    jsmpeg.prototype.initBuffers = function() {
      this.intraQuantMatrix = DEFAULT_INTRA_QUANT_MATRIX
      this.nonIntraQuantMatrix = DEFAULT_NON_INTRA_QUANT_MATRIX

      this.mbWidth = (this.width + 15) >> 4
      this.mbHeight = (this.height + 15) >> 4
      this.mbSize = this.mbWidth * this.mbHeight

      this.codedWidth = this.mbWidth << 4
      this.codedHeight = this.mbHeight << 4
      this.codedSize = this.codedWidth * this.codedHeight

      this.halfWidth = this.mbWidth << 3
      this.halfHeight = this.mbHeight << 3
      this.quarterSize = this.codedSize >> 2

      // Sequence already started? Don't allocate buffers again
      if (this.sequenceStarted) {
        return
      }
      this.sequenceStarted = true

      // Manually clamp values when writing macroblocks for shitty browsers
      // that don't support Uint8ClampedArray
      var MaybeClampedUint8Array = Uint8ClampedArray || Uint8Array
      if (!Uint8ClampedArray) {
        this.copyBlockToDestination = this.copyBlockToDestinationClamp
        this.addBlockToDestination = this.addBlockToDestinationClamp
      }

      // Allocated buffers and resize the canvas
      this.currentY = new MaybeClampedUint8Array(this.codedSize)
      this.currentY32 = new Uint32Array(this.currentY.buffer)

      this.currentCr = new MaybeClampedUint8Array(this.codedSize >> 2)
      this.currentCr32 = new Uint32Array(this.currentCr.buffer)

      this.currentCb = new MaybeClampedUint8Array(this.codedSize >> 2)
      this.currentCb32 = new Uint32Array(this.currentCb.buffer)

      this.forwardY = new MaybeClampedUint8Array(this.codedSize)
      this.forwardY32 = new Uint32Array(this.forwardY.buffer)

      this.forwardCr = new MaybeClampedUint8Array(this.codedSize >> 2)
      this.forwardCr32 = new Uint32Array(this.forwardCr.buffer)

      this.forwardCb = new MaybeClampedUint8Array(this.codedSize >> 2)
      this.forwardCb32 = new Uint32Array(this.forwardCb.buffer)

      //this.canvas.width = this.width;
      //this.canvas.height = this.height;

      if (this.gl) {
        //this.gl.useProgram(this.program)
        //this.gl.viewport(0, 0, this.width, this.height)
      } else {
        /*this.currentRGBA = this.canvasContext.getImageData(
          0,
          0,
          this.width,
          this.height
        )
        this.fillArray(this.currentRGBA.data, 255)*/
      }
      console.log("initBuffers");
    }

    // ----------------------------------------------------------------------------
    // Picture Layer

    jsmpeg.prototype.currentY = null
    jsmpeg.prototype.currentCr = null
    jsmpeg.prototype.currentCb = null

    jsmpeg.prototype.currentRGBA = null

    jsmpeg.prototype.pictureCodingType = 0

    // Buffers for motion compensation
    jsmpeg.prototype.forwardY = null
    jsmpeg.prototype.forwardCr = null
    jsmpeg.prototype.forwardCb = null

    jsmpeg.prototype.fullPelForward = false
    jsmpeg.prototype.forwardFCode = 0
    jsmpeg.prototype.forwardRSize = 0
    jsmpeg.prototype.forwardF = 0

    jsmpeg.prototype.decodePicture = function(skipOutput) {
      var pictureStart = this.buffer.index - 32
      this.currentFrame++
      this.currentTime = this.currentFrame / this.pictureRate

      this.buffer.advance(10) // skip temporalReference
      this.pictureCodingType = this.buffer.getBits(3)
      this.buffer.advance(16) // skip vbv_delay

      // Skip B and D frames or unknown coding type
      if (
        this.pictureCodingType <= 0 ||
        this.pictureCodingType >= PICTURE_TYPE_B
      ) {
        return
      }

      // full_pel_forward, forward_f_code
      if (this.pictureCodingType == PICTURE_TYPE_P) {
        this.fullPelForward = this.buffer.getBits(1)
        this.forwardFCode = this.buffer.getBits(3)
        if (this.forwardFCode == 0) {
          // Ignore picture with zero forward_f_code
          return
        }
        this.forwardRSize = this.forwardFCode - 1
        this.forwardF = 1 << this.forwardRSize
      }

      var code = 0
      do {
        code = this.buffer.findNextMPEGStartCode()
      } while (code == START_EXTENSION || code == START_USER_DATA)

      while (code >= START_SLICE_FIRST && code <= START_SLICE_LAST) {
        this.decodeSlice(code & 0x000000ff)
        code = this.buffer.findNextMPEGStartCode()
      }

      if (code !== BitReader.NOT_FOUND) {
        // We found the next start code; rewind 32bits and let the main loop handle it.
        this.buffer.rewind(32)
      }

      // Record this frame, if the recorder wants it
      this.recordFrame()
      if (skipOutput != DECODE_SKIP_OUTPUT) {
        this.renderFrame()
        this.outBuffer = true

        if (this.externalDecodeCallback) {
          this.externalDecodeCallback(this, this.canvas)
        }
      }

      // If this is a reference picutre then rotate the prediction pointers
      if (
        this.pictureCodingType == PICTURE_TYPE_I ||
        this.pictureCodingType == PICTURE_TYPE_P
      ) {
        var tmpY = this.forwardY,
          tmpY32 = this.forwardY32,
          tmpCr = this.forwardCr,
          tmpCr32 = this.forwardCr32,
          tmpCb = this.forwardCb,
          tmpCb32 = this.forwardCb32

        this.forwardY = this.currentY
        this.forwardY32 = this.currentY32
        this.forwardCr = this.currentCr
        this.forwardCr32 = this.currentCr32
        this.forwardCb = this.currentCb
        this.forwardCb32 = this.currentCb32

        this.currentY = tmpY
        this.currentY32 = tmpY32
        this.currentCr = tmpCr
        this.currentCr32 = tmpCr32
        this.currentCb = tmpCb
        this.currentCb32 = tmpCb32
      }
    }

    jsmpeg.prototype.YCbCrToRGBA = function() {
      var pY = this.currentY
      var pCb = this.currentCb
      var pCr = this.currentCr
      var pRGBA = this.currentRGBA.data

      // Chroma values are the same for each block of 4 pixels, so we proccess
      // 2 lines at a time, 2 neighboring pixels each.
      // I wish we could use 32bit writes to the RGBA buffer instead of writing
      // each byte separately, but we need the automatic clamping of the RGBA
      // buffer.

      var yIndex1 = 0
      var yIndex2 = this.codedWidth
      var yNext2Lines =
        this.codedWidth + (this.codedWidth - this.width)

      var cIndex = 0
      var cNextLine = this.halfWidth - (this.width >> 1)

      var rgbaIndex1 = 0
      var rgbaIndex2 = this.width * 4
      var rgbaNext2Lines = this.width * 4

      var cols = this.width >> 1
      var rows = this.height >> 1

      var y, cb, cr, r, g, b

      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          cb = pCb[cIndex]
          cr = pCr[cIndex]
          cIndex++

          r = cr + ((cr * 103) >> 8) - 179
          g = ((cb * 88) >> 8) - 44 + ((cr * 183) >> 8) - 91
          b = cb + ((cb * 198) >> 8) - 227

          // Line 1
          var y1 = pY[yIndex1++]
          var y2 = pY[yIndex1++]
          pRGBA[rgbaIndex1] = y1 + r
          pRGBA[rgbaIndex1 + 1] = y1 - g
          pRGBA[rgbaIndex1 + 2] = y1 + b
          pRGBA[rgbaIndex1 + 4] = y2 + r
          pRGBA[rgbaIndex1 + 5] = y2 - g
          pRGBA[rgbaIndex1 + 6] = y2 + b
          rgbaIndex1 += 8

          // Line 2
          var y3 = pY[yIndex2++]
          var y4 = pY[yIndex2++]
          pRGBA[rgbaIndex2] = y3 + r
          pRGBA[rgbaIndex2 + 1] = y3 - g
          pRGBA[rgbaIndex2 + 2] = y3 + b
          pRGBA[rgbaIndex2 + 4] = y4 + r
          pRGBA[rgbaIndex2 + 5] = y4 - g
          pRGBA[rgbaIndex2 + 6] = y4 + b
          rgbaIndex2 += 8
        }

        yIndex1 += yNext2Lines
        yIndex2 += yNext2Lines
        rgbaIndex1 += rgbaNext2Lines
        rgbaIndex2 += rgbaNext2Lines
        cIndex += cNextLine
      }
    }

    jsmpeg.prototype.renderFrame2D = function() {
      this.YCbCrToRGBA()
      this.canvasContext.putImageData(this.currentRGBA, 0, 0)
    }

    // ----------------------------------------------------------------------------
    // Accelerated WebGL YCbCrToRGBA conversion

    jsmpeg.prototype.gl = null
    jsmpeg.prototype.program = null
    jsmpeg.prototype.YTexture = null
    jsmpeg.prototype.CBTexture = null
    jsmpeg.prototype.CRTexture = null

    jsmpeg.prototype.createTexture = function(index, name) {
      var gl = this.gl
      var texture = gl.createTexture()

      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MAG_FILTER,
        gl.LINEAR
      )
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR
      )
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_S,
        gl.CLAMP_TO_EDGE
      )
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_T,
        gl.CLAMP_TO_EDGE
      )
      gl.uniform1i(gl.getUniformLocation(this.program, name), index)

      return texture
    }

    jsmpeg.prototype.compileShader = function(type, source) {
      var gl = this.gl
      var shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader))
      }

      return shader
    }

    jsmpeg.prototype.initWebGL = function() {
      this.pixels = GL.regl.texture()
      this.gl = GL
      return true
    }

    jsmpeg.prototype.renderFrameGL = function() {
      var gl = this.gl

      const { convertMPEG } = gl
      convertMPEG(
        {
          YTexture: {
            format: "luminance",
            width: this.codedWidth,
            height: this.height,
            source: this.currentY.buffer,
          },
          CBTexture: {
            format: "luminance",
            width: this.halfWidth,
            height: this.height / 2,
            source: this.currentCr.buffer,
          },
          CRTexture: {
            format: "luminance",
            width: this.halfWidth,
            height: this.height / 2,
            source: this.currentCb.buffer,
          },
        },
        { scale: isBigScreen ? 0.9 : 1 }
      )
      this.pixels({
        copy: true,
      })

      return

      // WebGL doesn't like Uint8ClampedArrays, so we have to create a Uint8Array view for
      // each plane
      var uint8Y = new Uint8Array(this.currentY.buffer),
        uint8Cr = new Uint8Array(this.currentCr.buffer),
        uint8Cb = new Uint8Array(this.currentCb.buffer)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.YTexture)

      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        this.codedWidth,
        this.height,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        uint8Y
      )

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.CBTexture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        this.halfWidth,
        this.height / 2,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        uint8Cr
      )

      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.CRTexture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        this.halfWidth,
        this.height / 2,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        uint8Cb
      )

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    // ----------------------------------------------------------------------------
    // Slice Layer

    jsmpeg.prototype.quantizerScale = 0
    jsmpeg.prototype.sliceBegin = false

    jsmpeg.prototype.decodeSlice = function(slice) {
      this.sliceBegin = true
      this.macroblockAddress = (slice - 1) * this.mbWidth - 1

      // Reset motion vectors and DC predictors
      this.motionFwH = this.motionFwHPrev = 0
      this.motionFwV = this.motionFwVPrev = 0
      this.dcPredictorY = 128
      this.dcPredictorCr = 128
      this.dcPredictorCb = 128

      this.quantizerScale = this.buffer.getBits(5)

      // skip extra bits
      while (this.buffer.getBits(1)) {
        this.buffer.advance(8)
      }

      do {
        this.decodeMacroblock()
        // We may have to ignore Video Stream Start Codes here (0xE0)!?
      } while (!this.buffer.nextBytesAreStartCode())
    }

    // ----------------------------------------------------------------------------
    // Macroblock Layer

    jsmpeg.prototype.macroblockAddress = 0
    jsmpeg.prototype.mbRow = 0
    jsmpeg.prototype.mbCol = 0

    jsmpeg.prototype.macroblockType = 0
    jsmpeg.prototype.macroblockIntra = false
    jsmpeg.prototype.macroblockMotFw = false

    jsmpeg.prototype.motionFwH = 0
    jsmpeg.prototype.motionFwV = 0
    jsmpeg.prototype.motionFwHPrev = 0
    jsmpeg.prototype.motionFwVPrev = 0

    jsmpeg.prototype.decodeMacroblock = function() {
      // Decode macroblock_address_increment
      var increment = 0,
        t = this.readCode(MACROBLOCK_ADDRESS_INCREMENT)

      while (t == 34) {
        // macroblock_stuffing
        t = this.readCode(MACROBLOCK_ADDRESS_INCREMENT)
      }
      while (t == 35) {
        // macroblock_escape
        increment += 33
        t = this.readCode(MACROBLOCK_ADDRESS_INCREMENT)
      }
      increment += t

      // Process any skipped macroblocks
      if (this.sliceBegin) {
        // The first macroblock_address_increment of each slice is relative
        // to beginning of the preverious row, not the preverious macroblock
        this.sliceBegin = false
        this.macroblockAddress += increment
      } else {
        if (this.macroblockAddress + increment >= this.mbSize) {
          // Illegal (too large) macroblock_address_increment
          return
        }
        if (increment > 1) {
          // Skipped macroblocks reset DC predictors
          this.dcPredictorY = 128
          this.dcPredictorCr = 128
          this.dcPredictorCb = 128

          // Skipped macroblocks in P-pictures reset motion vectors
          if (this.pictureCodingType == PICTURE_TYPE_P) {
            this.motionFwH = this.motionFwHPrev = 0
            this.motionFwV = this.motionFwVPrev = 0
          }
        }

        // Predict skipped macroblocks
        while (increment > 1) {
          this.macroblockAddress++
          this.mbRow = (this.macroblockAddress / this.mbWidth) | 0
          this.mbCol = this.macroblockAddress % this.mbWidth
          this.copyMacroblock(
            this.motionFwH,
            this.motionFwV,
            this.forwardY,
            this.forwardCr,
            this.forwardCb
          )
          increment--
        }
        this.macroblockAddress++
      }
      this.mbRow = (this.macroblockAddress / this.mbWidth) | 0
      this.mbCol = this.macroblockAddress % this.mbWidth

      // Process the current macroblock
      this.macroblockType = this.readCode(
        MACROBLOCK_TYPE_TABLES[this.pictureCodingType]
      )
      this.macroblockIntra = this.macroblockType & 0x01
      this.macroblockMotFw = this.macroblockType & 0x08

      // Quantizer scale
      if ((this.macroblockType & 0x10) != 0) {
        this.quantizerScale = this.buffer.getBits(5)
      }

      if (this.macroblockIntra) {
        // Intra-coded macroblocks reset motion vectors
        this.motionFwH = this.motionFwHPrev = 0
        this.motionFwV = this.motionFwVPrev = 0
      } else {
        // Non-intra macroblocks reset DC predictors
        this.dcPredictorY = 128
        this.dcPredictorCr = 128
        this.dcPredictorCb = 128

        this.decodeMotionVectors()
        this.copyMacroblock(
          this.motionFwH,
          this.motionFwV,
          this.forwardY,
          this.forwardCr,
          this.forwardCb
        )
      }

      // Decode blocks
      var cbp =
        (this.macroblockType & 0x02) != 0
          ? this.readCode(CODE_BLOCK_PATTERN)
          : this.macroblockIntra ? 0x3f : 0

      for (var block = 0, mask = 0x20; block < 6; block++) {
        if ((cbp & mask) != 0) {
          this.decodeBlock(block)
        }
        mask >>= 1
      }
    }

    jsmpeg.prototype.decodeMotionVectors = function() {
      var code,
        d,
        r = 0

      // Forward
      if (this.macroblockMotFw) {
        // Horizontal forward
        code = this.readCode(MOTION)
        if (code != 0 && this.forwardF != 1) {
          r = this.buffer.getBits(this.forwardRSize)
          d = ((Math.abs(code) - 1) << this.forwardRSize) + r + 1
          if (code < 0) {
            d = -d
          }
        } else {
          d = code
        }

        this.motionFwHPrev += d
        if (this.motionFwHPrev > (this.forwardF << 4) - 1) {
          this.motionFwHPrev -= this.forwardF << 5
        } else if (this.motionFwHPrev < -this.forwardF << 4) {
          this.motionFwHPrev += this.forwardF << 5
        }

        this.motionFwH = this.motionFwHPrev
        if (this.fullPelForward) {
          this.motionFwH <<= 1
        }

        // Vertical forward
        code = this.readCode(MOTION)
        if (code != 0 && this.forwardF != 1) {
          r = this.buffer.getBits(this.forwardRSize)
          d = ((Math.abs(code) - 1) << this.forwardRSize) + r + 1
          if (code < 0) {
            d = -d
          }
        } else {
          d = code
        }

        this.motionFwVPrev += d
        if (this.motionFwVPrev > (this.forwardF << 4) - 1) {
          this.motionFwVPrev -= this.forwardF << 5
        } else if (this.motionFwVPrev < -this.forwardF << 4) {
          this.motionFwVPrev += this.forwardF << 5
        }

        this.motionFwV = this.motionFwVPrev
        if (this.fullPelForward) {
          this.motionFwV <<= 1
        }
      } else if (this.pictureCodingType == PICTURE_TYPE_P) {
        // No motion information in P-picture, reset vectors
        this.motionFwH = this.motionFwHPrev = 0
        this.motionFwV = this.motionFwVPrev = 0
      }
    }

    jsmpeg.prototype.copyMacroblock = function(
      motionH,
      motionV,
      sY,
      sCr,
      sCb
    ) {
      var width, scan, H, V, oddH, oddV, src, dest, last

      // We use 32bit writes here
      var dY = this.currentY32
      var dCb = this.currentCb32
      var dCr = this.currentCr32

      // Luminance
      width = this.codedWidth
      scan = width - 16

      H = motionH >> 1
      V = motionV >> 1
      oddH = (motionH & 1) == 1
      oddV = (motionV & 1) == 1

      src = ((this.mbRow << 4) + V) * width + (this.mbCol << 4) + H
      dest = (this.mbRow * width + this.mbCol) << 2
      last = dest + (width << 2)

      var y1, y2, y
      if (oddH) {
        if (oddV) {
          while (dest < last) {
            y1 = sY[src] + sY[src + width]
            src++
            for (var x = 0; x < 4; x++) {
              y2 = sY[src] + sY[src + width]
              src++
              y = ((y1 + y2 + 2) >> 2) & 0xff

              y1 = sY[src] + sY[src + width]
              src++
              y |= ((y1 + y2 + 2) << 6) & 0xff00

              y2 = sY[src] + sY[src + width]
              src++
              y |= ((y1 + y2 + 2) << 14) & 0xff0000

              y1 = sY[src] + sY[src + width]
              src++
              y |= ((y1 + y2 + 2) << 22) & 0xff000000

              dY[dest++] = y
            }
            dest += scan >> 2
            src += scan - 1
          }
        } else {
          while (dest < last) {
            y1 = sY[src++]
            for (var x = 0; x < 4; x++) {
              y2 = sY[src++]
              y = ((y1 + y2 + 1) >> 1) & 0xff

              y1 = sY[src++]
              y |= ((y1 + y2 + 1) << 7) & 0xff00

              y2 = sY[src++]
              y |= ((y1 + y2 + 1) << 15) & 0xff0000

              y1 = sY[src++]
              y |= ((y1 + y2 + 1) << 23) & 0xff000000

              dY[dest++] = y
            }
            dest += scan >> 2
            src += scan - 1
          }
        }
      } else {
        if (oddV) {
          while (dest < last) {
            for (var x = 0; x < 4; x++) {
              y = ((sY[src] + sY[src + width] + 1) >> 1) & 0xff
              src++
              y |= ((sY[src] + sY[src + width] + 1) << 7) & 0xff00
              src++
              y |= ((sY[src] + sY[src + width] + 1) << 15) & 0xff0000
              src++
              y |=
                ((sY[src] + sY[src + width] + 1) << 23) & 0xff000000
              src++

              dY[dest++] = y
            }
            dest += scan >> 2
            src += scan
          }
        } else {
          while (dest < last) {
            for (var x = 0; x < 4; x++) {
              y = sY[src]
              src++
              y |= sY[src] << 8
              src++
              y |= sY[src] << 16
              src++
              y |= sY[src] << 24
              src++

              dY[dest++] = y
            }
            dest += scan >> 2
            src += scan
          }
        }
      }

      // Chrominance

      width = this.halfWidth
      scan = width - 8

      H = (motionH / 2) >> 1
      V = (motionV / 2) >> 1
      oddH = ((motionH / 2) & 1) == 1
      oddV = ((motionV / 2) & 1) == 1

      src = ((this.mbRow << 3) + V) * width + (this.mbCol << 3) + H
      dest = (this.mbRow * width + this.mbCol) << 1
      last = dest + (width << 1)

      var cr1, cr2, cr
      var cb1, cb2, cb
      if (oddH) {
        if (oddV) {
          while (dest < last) {
            cr1 = sCr[src] + sCr[src + width]
            cb1 = sCb[src] + sCb[src + width]
            src++
            for (var x = 0; x < 2; x++) {
              cr2 = sCr[src] + sCr[src + width]
              cb2 = sCb[src] + sCb[src + width]
              src++
              cr = ((cr1 + cr2 + 2) >> 2) & 0xff
              cb = ((cb1 + cb2 + 2) >> 2) & 0xff

              cr1 = sCr[src] + sCr[src + width]
              cb1 = sCb[src] + sCb[src + width]
              src++
              cr |= ((cr1 + cr2 + 2) << 6) & 0xff00
              cb |= ((cb1 + cb2 + 2) << 6) & 0xff00

              cr2 = sCr[src] + sCr[src + width]
              cb2 = sCb[src] + sCb[src + width]
              src++
              cr |= ((cr1 + cr2 + 2) << 14) & 0xff0000
              cb |= ((cb1 + cb2 + 2) << 14) & 0xff0000

              cr1 = sCr[src] + sCr[src + width]
              cb1 = sCb[src] + sCb[src + width]
              src++
              cr |= ((cr1 + cr2 + 2) << 22) & 0xff000000
              cb |= ((cb1 + cb2 + 2) << 22) & 0xff000000

              dCr[dest] = cr
              dCb[dest] = cb
              dest++
            }
            dest += scan >> 2
            src += scan - 1
          }
        } else {
          while (dest < last) {
            cr1 = sCr[src]
            cb1 = sCb[src]
            src++
            for (var x = 0; x < 2; x++) {
              cr2 = sCr[src]
              cb2 = sCb[src++]
              cr = ((cr1 + cr2 + 1) >> 1) & 0xff
              cb = ((cb1 + cb2 + 1) >> 1) & 0xff

              cr1 = sCr[src]
              cb1 = sCb[src++]
              cr |= ((cr1 + cr2 + 1) << 7) & 0xff00
              cb |= ((cb1 + cb2 + 1) << 7) & 0xff00

              cr2 = sCr[src]
              cb2 = sCb[src++]
              cr |= ((cr1 + cr2 + 1) << 15) & 0xff0000
              cb |= ((cb1 + cb2 + 1) << 15) & 0xff0000

              cr1 = sCr[src]
              cb1 = sCb[src++]
              cr |= ((cr1 + cr2 + 1) << 23) & 0xff000000
              cb |= ((cb1 + cb2 + 1) << 23) & 0xff000000

              dCr[dest] = cr
              dCb[dest] = cb
              dest++
            }
            dest += scan >> 2
            src += scan - 1
          }
        }
      } else {
        if (oddV) {
          while (dest < last) {
            for (var x = 0; x < 2; x++) {
              cr = ((sCr[src] + sCr[src + width] + 1) >> 1) & 0xff
              cb = ((sCb[src] + sCb[src + width] + 1) >> 1) & 0xff
              src++

              cr |= ((sCr[src] + sCr[src + width] + 1) << 7) & 0xff00
              cb |= ((sCb[src] + sCb[src + width] + 1) << 7) & 0xff00
              src++

              cr |=
                ((sCr[src] + sCr[src + width] + 1) << 15) & 0xff0000
              cb |=
                ((sCb[src] + sCb[src + width] + 1) << 15) & 0xff0000
              src++

              cr |=
                ((sCr[src] + sCr[src + width] + 1) << 23) & 0xff000000
              cb |=
                ((sCb[src] + sCb[src + width] + 1) << 23) & 0xff000000
              src++

              dCr[dest] = cr
              dCb[dest] = cb
              dest++
            }
            dest += scan >> 2
            src += scan
          }
        } else {
          while (dest < last) {
            for (var x = 0; x < 2; x++) {
              cr = sCr[src]
              cb = sCb[src]
              src++

              cr |= sCr[src] << 8
              cb |= sCb[src] << 8
              src++

              cr |= sCr[src] << 16
              cb |= sCb[src] << 16
              src++

              cr |= sCr[src] << 24
              cb |= sCb[src] << 24
              src++

              dCr[dest] = cr
              dCb[dest] = cb
              dest++
            }
            dest += scan >> 2
            src += scan
          }
        }
      }
    }

    // ----------------------------------------------------------------------------
    // Block layer

    jsmpeg.prototype.dcPredictorY
    jsmpeg.prototype.dcPredictorCr
    jsmpeg.prototype.dcPredictorCb

    jsmpeg.prototype.blockData = null
    jsmpeg.prototype.decodeBlock = function(block) {
      var n = 0,
        quantMatrix

      // Decode DC coefficient of intra-coded blocks
      if (this.macroblockIntra) {
        var predictor, dctSize

        // DC prediction

        if (block < 4) {
          predictor = this.dcPredictorY
          dctSize = this.readCode(DCT_DC_SIZE_LUMINANCE)
        } else {
          predictor =
            block == 4 ? this.dcPredictorCr : this.dcPredictorCb
          dctSize = this.readCode(DCT_DC_SIZE_CHROMINANCE)
        }

        // Read DC coeff
        if (dctSize > 0) {
          var differential = this.buffer.getBits(dctSize)
          if ((differential & (1 << (dctSize - 1))) != 0) {
            this.blockData[0] = predictor + differential
          } else {
            this.blockData[0] =
              predictor + ((-1 << dctSize) | (differential + 1))
          }
        } else {
          this.blockData[0] = predictor
        }

        // Save predictor value
        if (block < 4) {
          this.dcPredictorY = this.blockData[0]
        } else if (block == 4) {
          this.dcPredictorCr = this.blockData[0]
        } else {
          this.dcPredictorCb = this.blockData[0]
        }

        // Dequantize + premultiply
        this.blockData[0] <<= 3 + 5

        quantMatrix = this.intraQuantMatrix
        n = 1
      } else {
        quantMatrix = this.nonIntraQuantMatrix
      }

      // Decode AC coefficients (+DC for non-intra)
      var level = 0
      while (true) {
        var run = 0,
          coeff = this.readCode(DCT_COEFF)

        if (coeff == 0x0001 && n > 0 && this.buffer.getBits(1) == 0) {
          // end_of_block
          break
        }
        if (coeff == 0xffff) {
          // escape
          run = this.buffer.getBits(6)
          level = this.buffer.getBits(8)
          if (level == 0) {
            level = this.buffer.getBits(8)
          } else if (level == 128) {
            level = this.buffer.getBits(8) - 256
          } else if (level > 128) {
            level = level - 256
          }
        } else {
          run = coeff >> 8
          level = coeff & 0xff
          if (this.buffer.getBits(1)) {
            level = -level
          }
        }

        n += run
        var dezigZagged = ZIG_ZAG[n]
        n++

        // Dequantize, oddify, clip
        level <<= 1
        if (!this.macroblockIntra) {
          level += level < 0 ? -1 : 1
        }
        level =
          (level * this.quantizerScale * quantMatrix[dezigZagged]) >>
          4
        if ((level & 1) == 0) {
          level -= level > 0 ? 1 : -1
        }
        if (level > 2047) {
          level = 2047
        } else if (level < -2048) {
          level = -2048
        }

        // Save premultiplied coefficient
        this.blockData[dezigZagged] =
          level * PREMULTIPLIER_MATRIX[dezigZagged]
      }

      // Move block to its place
      var destArray, destIndex, scan

      if (block < 4) {
        destArray = this.currentY
        scan = this.codedWidth - 8
        destIndex = (this.mbRow * this.codedWidth + this.mbCol) << 4
        if ((block & 1) != 0) {
          destIndex += 8
        }
        if ((block & 2) != 0) {
          destIndex += this.codedWidth << 3
        }
      } else {
        destArray = block == 4 ? this.currentCb : this.currentCr
        scan = (this.codedWidth >> 1) - 8
        destIndex =
          ((this.mbRow * this.codedWidth) << 2) + (this.mbCol << 3)
      }

      if (this.macroblockIntra) {
        // Overwrite (no prediction)
        if (n == 1) {
          this.copyValueToDestination(
            (this.blockData[0] + 128) >> 8,
            destArray,
            destIndex,
            scan
          )
          this.blockData[0] = 0
        } else {
          this.IDCT()
          this.copyBlockToDestination(
            this.blockData,
            destArray,
            destIndex,
            scan
          )
          this.blockData.set(this.zeroBlockData)
        }
      } else {
        // Add data to the predicted macroblock
        if (n == 1) {
          this.addValueToDestination(
            (this.blockData[0] + 128) >> 8,
            destArray,
            destIndex,
            scan
          )
          this.blockData[0] = 0
        } else {
          this.IDCT()
          this.addBlockToDestination(
            this.blockData,
            destArray,
            destIndex,
            scan
          )
          this.blockData.set(this.zeroBlockData)
        }
      }

      n = 0
    }

    jsmpeg.prototype.copyBlockToDestination = function(
      blockData,
      destArray,
      destIndex,
      scan
    ) {
      for (var n = 0; n < 64; n += 8, destIndex += scan + 8) {
        destArray[destIndex + 0] = blockData[n + 0]
        destArray[destIndex + 1] = blockData[n + 1]
        destArray[destIndex + 2] = blockData[n + 2]
        destArray[destIndex + 3] = blockData[n + 3]
        destArray[destIndex + 4] = blockData[n + 4]
        destArray[destIndex + 5] = blockData[n + 5]
        destArray[destIndex + 6] = blockData[n + 6]
        destArray[destIndex + 7] = blockData[n + 7]
      }
    }

    jsmpeg.prototype.addBlockToDestination = function(
      blockData,
      destArray,
      destIndex,
      scan
    ) {
      for (var n = 0; n < 64; n += 8, destIndex += scan + 8) {
        destArray[destIndex + 0] += blockData[n + 0]
        destArray[destIndex + 1] += blockData[n + 1]
        destArray[destIndex + 2] += blockData[n + 2]
        destArray[destIndex + 3] += blockData[n + 3]
        destArray[destIndex + 4] += blockData[n + 4]
        destArray[destIndex + 5] += blockData[n + 5]
        destArray[destIndex + 6] += blockData[n + 6]
        destArray[destIndex + 7] += blockData[n + 7]
      }
    }

    jsmpeg.prototype.copyValueToDestination = function(
      value,
      destArray,
      destIndex,
      scan
    ) {
      for (var n = 0; n < 64; n += 8, destIndex += scan + 8) {
        destArray[destIndex + 0] = value
        destArray[destIndex + 1] = value
        destArray[destIndex + 2] = value
        destArray[destIndex + 3] = value
        destArray[destIndex + 4] = value
        destArray[destIndex + 5] = value
        destArray[destIndex + 6] = value
        destArray[destIndex + 7] = value
      }
    }

    jsmpeg.prototype.addValueToDestination = function(
      value,
      destArray,
      destIndex,
      scan
    ) {
      for (var n = 0; n < 64; n += 8, destIndex += scan + 8) {
        destArray[destIndex + 0] += value
        destArray[destIndex + 1] += value
        destArray[destIndex + 2] += value
        destArray[destIndex + 3] += value
        destArray[destIndex + 4] += value
        destArray[destIndex + 5] += value
        destArray[destIndex + 6] += value
        destArray[destIndex + 7] += value
      }
    }

    // Clamping version for shitty browsers (IE) that don't support Uint8ClampedArray
    jsmpeg.prototype.copyBlockToDestinationClamp = function(
      blockData,
      destArray,
      destIndex,
      scan
    ) {
      var n = 0
      for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
          var p = blockData[n++]
          destArray[destIndex++] = p > 255 ? 255 : p < 0 ? 0 : p
        }
        destIndex += scan
      }
    }

    jsmpeg.prototype.addBlockToDestinationClamp = function(
      blockData,
      destArray,
      destIndex,
      scan
    ) {
      var n = 0
      for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
          var p = blockData[n++] + destArray[destIndex]
          destArray[destIndex++] = p > 255 ? 255 : p < 0 ? 0 : p
        }
        destIndex += scan
      }
    }

    jsmpeg.prototype.IDCT = function() {
      // See http://vsr.informatik.tu-chemnitz.de/~jan/MPEG/HTML/IDCT.html
      // for more info.

      var b1,
        b3,
        b4,
        b6,
        b7,
        tmp1,
        tmp2,
        m0,
        x0,
        x1,
        x2,
        x3,
        x4,
        y3,
        y4,
        y5,
        y6,
        y7,
        i,
        blockData = this.blockData

      // Transform columns
      for (i = 0; i < 8; ++i) {
        b1 = blockData[4 * 8 + i]
        b3 = blockData[2 * 8 + i] + blockData[6 * 8 + i]
        b4 = blockData[5 * 8 + i] - blockData[3 * 8 + i]
        tmp1 = blockData[1 * 8 + i] + blockData[7 * 8 + i]
        tmp2 = blockData[3 * 8 + i] + blockData[5 * 8 + i]
        b6 = blockData[1 * 8 + i] - blockData[7 * 8 + i]
        b7 = tmp1 + tmp2
        m0 = blockData[0 * 8 + i]
        x4 = ((b6 * 473 - b4 * 196 + 128) >> 8) - b7
        x0 = x4 - (((tmp1 - tmp2) * 362 + 128) >> 8)
        x1 = m0 - b1
        x2 =
          (((blockData[2 * 8 + i] - blockData[6 * 8 + i]) * 362 +
            128) >>
            8) -
          b3
        x3 = m0 + b1
        y3 = x1 + x2
        y4 = x3 + b3
        y5 = x1 - x2
        y6 = x3 - b3
        y7 = -x0 - ((b4 * 473 + b6 * 196 + 128) >> 8)
        blockData[0 * 8 + i] = b7 + y4
        blockData[1 * 8 + i] = x4 + y3
        blockData[2 * 8 + i] = y5 - x0
        blockData[3 * 8 + i] = y6 - y7
        blockData[4 * 8 + i] = y6 + y7
        blockData[5 * 8 + i] = x0 + y5
        blockData[6 * 8 + i] = y3 - x4
        blockData[7 * 8 + i] = y4 - b7
      }

      // Transform rows
      for (i = 0; i < 64; i += 8) {
        b1 = blockData[4 + i]
        b3 = blockData[2 + i] + blockData[6 + i]
        b4 = blockData[5 + i] - blockData[3 + i]
        tmp1 = blockData[1 + i] + blockData[7 + i]
        tmp2 = blockData[3 + i] + blockData[5 + i]
        b6 = blockData[1 + i] - blockData[7 + i]
        b7 = tmp1 + tmp2
        m0 = blockData[0 + i]
        x4 = ((b6 * 473 - b4 * 196 + 128) >> 8) - b7
        x0 = x4 - (((tmp1 - tmp2) * 362 + 128) >> 8)
        x1 = m0 - b1
        x2 =
          (((blockData[2 + i] - blockData[6 + i]) * 362 + 128) >> 8) -
          b3
        x3 = m0 + b1
        y3 = x1 + x2
        y4 = x3 + b3
        y5 = x1 - x2
        y6 = x3 - b3
        y7 = -x0 - ((b4 * 473 + b6 * 196 + 128) >> 8)
        blockData[0 + i] = (b7 + y4 + 128) >> 8
        blockData[1 + i] = (x4 + y3 + 128) >> 8
        blockData[2 + i] = (y5 - x0 + 128) >> 8
        blockData[3 + i] = (y6 - y7 + 128) >> 8
        blockData[4 + i] = (y6 + y7 + 128) >> 8
        blockData[5 + i] = (x0 + y5 + 128) >> 8
        blockData[6 + i] = (y3 - x4 + 128) >> 8
        blockData[7 + i] = (y4 - b7 + 128) >> 8
      }
    }

    // ----------------------------------------------------------------------------
    // VLC Tables and Constants

    var SOCKET_MAGIC_BYTES = "jsmp",
      DECODE_SKIP_OUTPUT = 1,
      PICTURE_RATE = [
        0.0,
        23.976,
        24.0,
        25.0,
        29.97,
        30.0,
        50.0,
        59.94,
        60.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
      ],
      ZIG_ZAG = new Uint8Array([
        0,
        1,
        8,
        16,
        9,
        2,
        3,
        10,
        17,
        24,
        32,
        25,
        18,
        11,
        4,
        5,
        12,
        19,
        26,
        33,
        40,
        48,
        41,
        34,
        27,
        20,
        13,
        6,
        7,
        14,
        21,
        28,
        35,
        42,
        49,
        56,
        57,
        50,
        43,
        36,
        29,
        22,
        15,
        23,
        30,
        37,
        44,
        51,
        58,
        59,
        52,
        45,
        38,
        31,
        39,
        46,
        53,
        60,
        61,
        54,
        47,
        55,
        62,
        63,
      ]),
      DEFAULT_INTRA_QUANT_MATRIX = new Uint8Array([
        8,
        16,
        19,
        22,
        26,
        27,
        29,
        34,
        16,
        16,
        22,
        24,
        27,
        29,
        34,
        37,
        19,
        22,
        26,
        27,
        29,
        34,
        34,
        38,
        22,
        22,
        26,
        27,
        29,
        34,
        37,
        40,
        22,
        26,
        27,
        29,
        32,
        35,
        40,
        48,
        26,
        27,
        29,
        32,
        35,
        40,
        48,
        58,
        26,
        27,
        29,
        34,
        38,
        46,
        56,
        69,
        27,
        29,
        35,
        38,
        46,
        56,
        69,
        83,
      ]),
      DEFAULT_NON_INTRA_QUANT_MATRIX = new Uint8Array([
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
      ]),
      PREMULTIPLIER_MATRIX = new Uint8Array([
        32,
        44,
        42,
        38,
        32,
        25,
        17,
        9,
        44,
        62,
        58,
        52,
        44,
        35,
        24,
        12,
        42,
        58,
        55,
        49,
        42,
        33,
        23,
        12,
        38,
        52,
        49,
        44,
        38,
        30,
        20,
        10,
        32,
        44,
        42,
        38,
        32,
        25,
        17,
        9,
        25,
        35,
        33,
        30,
        25,
        20,
        14,
        7,
        17,
        24,
        23,
        20,
        17,
        14,
        9,
        5,
        9,
        12,
        12,
        10,
        9,
        7,
        5,
        2,
      ]),
      // MPEG-1 VLC

      //  macroblock_stuffing decodes as 34.
      //  macroblock_escape decodes as 35.

      MACROBLOCK_ADDRESS_INCREMENT = new Int16Array([
        1 * 3,
        2 * 3,
        0, //   0
        3 * 3,
        4 * 3,
        0, //   1  0
        0,
        0,
        1, //   2  1.
        5 * 3,
        6 * 3,
        0, //   3  00
        7 * 3,
        8 * 3,
        0, //   4  01
        9 * 3,
        10 * 3,
        0, //   5  000
        11 * 3,
        12 * 3,
        0, //   6  001
        0,
        0,
        3, //   7  010.
        0,
        0,
        2, //   8  011.
        13 * 3,
        14 * 3,
        0, //   9  0000
        15 * 3,
        16 * 3,
        0, //  10  0001
        0,
        0,
        5, //  11  0010.
        0,
        0,
        4, //  12  0011.
        17 * 3,
        18 * 3,
        0, //  13  0000 0
        19 * 3,
        20 * 3,
        0, //  14  0000 1
        0,
        0,
        7, //  15  0001 0.
        0,
        0,
        6, //  16  0001 1.
        21 * 3,
        22 * 3,
        0, //  17  0000 00
        23 * 3,
        24 * 3,
        0, //  18  0000 01
        25 * 3,
        26 * 3,
        0, //  19  0000 10
        27 * 3,
        28 * 3,
        0, //  20  0000 11
        -1,
        29 * 3,
        0, //  21  0000 000
        -1,
        30 * 3,
        0, //  22  0000 001
        31 * 3,
        32 * 3,
        0, //  23  0000 010
        33 * 3,
        34 * 3,
        0, //  24  0000 011
        35 * 3,
        36 * 3,
        0, //  25  0000 100
        37 * 3,
        38 * 3,
        0, //  26  0000 101
        0,
        0,
        9, //  27  0000 110.
        0,
        0,
        8, //  28  0000 111.
        39 * 3,
        40 * 3,
        0, //  29  0000 0001
        41 * 3,
        42 * 3,
        0, //  30  0000 0011
        43 * 3,
        44 * 3,
        0, //  31  0000 0100
        45 * 3,
        46 * 3,
        0, //  32  0000 0101
        0,
        0,
        15, //  33  0000 0110.
        0,
        0,
        14, //  34  0000 0111.
        0,
        0,
        13, //  35  0000 1000.
        0,
        0,
        12, //  36  0000 1001.
        0,
        0,
        11, //  37  0000 1010.
        0,
        0,
        10, //  38  0000 1011.
        47 * 3,
        -1,
        0, //  39  0000 0001 0
        -1,
        48 * 3,
        0, //  40  0000 0001 1
        49 * 3,
        50 * 3,
        0, //  41  0000 0011 0
        51 * 3,
        52 * 3,
        0, //  42  0000 0011 1
        53 * 3,
        54 * 3,
        0, //  43  0000 0100 0
        55 * 3,
        56 * 3,
        0, //  44  0000 0100 1
        57 * 3,
        58 * 3,
        0, //  45  0000 0101 0
        59 * 3,
        60 * 3,
        0, //  46  0000 0101 1
        61 * 3,
        -1,
        0, //  47  0000 0001 00
        -1,
        62 * 3,
        0, //  48  0000 0001 11
        63 * 3,
        64 * 3,
        0, //  49  0000 0011 00
        65 * 3,
        66 * 3,
        0, //  50  0000 0011 01
        67 * 3,
        68 * 3,
        0, //  51  0000 0011 10
        69 * 3,
        70 * 3,
        0, //  52  0000 0011 11
        71 * 3,
        72 * 3,
        0, //  53  0000 0100 00
        73 * 3,
        74 * 3,
        0, //  54  0000 0100 01
        0,
        0,
        21, //  55  0000 0100 10.
        0,
        0,
        20, //  56  0000 0100 11.
        0,
        0,
        19, //  57  0000 0101 00.
        0,
        0,
        18, //  58  0000 0101 01.
        0,
        0,
        17, //  59  0000 0101 10.
        0,
        0,
        16, //  60  0000 0101 11.
        0,
        0,
        35, //  61  0000 0001 000. -- macroblock_escape
        0,
        0,
        34, //  62  0000 0001 111. -- macroblock_stuffing
        0,
        0,
        33, //  63  0000 0011 000.
        0,
        0,
        32, //  64  0000 0011 001.
        0,
        0,
        31, //  65  0000 0011 010.
        0,
        0,
        30, //  66  0000 0011 011.
        0,
        0,
        29, //  67  0000 0011 100.
        0,
        0,
        28, //  68  0000 0011 101.
        0,
        0,
        27, //  69  0000 0011 110.
        0,
        0,
        26, //  70  0000 0011 111.
        0,
        0,
        25, //  71  0000 0100 000.
        0,
        0,
        24, //  72  0000 0100 001.
        0,
        0,
        23, //  73  0000 0100 010.
        0,
        0,
        22, //  74  0000 0100 011.
      ]),
      //  macroblock_type bitmap:
      //    0x10  macroblock_quant
      //    0x08  macroblock_motion_forward
      //    0x04  macroblock_motion_backward
      //    0x02  macrobkock_pattern
      //    0x01  macroblock_intra
      //

      MACROBLOCK_TYPE_I = new Int8Array([
        1 * 3,
        2 * 3,
        0, //   0
        -1,
        3 * 3,
        0, //   1  0
        0,
        0,
        0x01, //   2  1.
        0,
        0,
        0x11, //   3  01.
      ]),
      MACROBLOCK_TYPE_P = new Int8Array([
        1 * 3,
        2 * 3,
        0, //  0
        3 * 3,
        4 * 3,
        0, //  1  0
        0,
        0,
        0x0a, //  2  1.
        5 * 3,
        6 * 3,
        0, //  3  00
        0,
        0,
        0x02, //  4  01.
        7 * 3,
        8 * 3,
        0, //  5  000
        0,
        0,
        0x08, //  6  001.
        9 * 3,
        10 * 3,
        0, //  7  0000
        11 * 3,
        12 * 3,
        0, //  8  0001
        -1,
        13 * 3,
        0, //  9  00000
        0,
        0,
        0x12, // 10  00001.
        0,
        0,
        0x1a, // 11  00010.
        0,
        0,
        0x01, // 12  00011.
        0,
        0,
        0x11, // 13  000001.
      ]),
      MACROBLOCK_TYPE_B = new Int8Array([
        1 * 3,
        2 * 3,
        0, //  0
        3 * 3,
        5 * 3,
        0, //  1  0
        4 * 3,
        6 * 3,
        0, //  2  1
        8 * 3,
        7 * 3,
        0, //  3  00
        0,
        0,
        0x0c, //  4  10.
        9 * 3,
        10 * 3,
        0, //  5  01
        0,
        0,
        0x0e, //  6  11.
        13 * 3,
        14 * 3,
        0, //  7  001
        12 * 3,
        11 * 3,
        0, //  8  000
        0,
        0,
        0x04, //  9  010.
        0,
        0,
        0x06, // 10  011.
        18 * 3,
        16 * 3,
        0, // 11  0001
        15 * 3,
        17 * 3,
        0, // 12  0000
        0,
        0,
        0x08, // 13  0010.
        0,
        0,
        0x0a, // 14  0011.
        -1,
        19 * 3,
        0, // 15  00000
        0,
        0,
        0x01, // 16  00011.
        20 * 3,
        21 * 3,
        0, // 17  00001
        0,
        0,
        0x1e, // 18  00010.
        0,
        0,
        0x11, // 19  000001.
        0,
        0,
        0x16, // 20  000010.
        0,
        0,
        0x1a, // 21  000011.
      ]),
      CODE_BLOCK_PATTERN = new Int16Array([
        2 * 3,
        1 * 3,
        0, //   0
        3 * 3,
        6 * 3,
        0, //   1  1
        4 * 3,
        5 * 3,
        0, //   2  0
        8 * 3,
        11 * 3,
        0, //   3  10
        12 * 3,
        13 * 3,
        0, //   4  00
        9 * 3,
        7 * 3,
        0, //   5  01
        10 * 3,
        14 * 3,
        0, //   6  11
        20 * 3,
        19 * 3,
        0, //   7  011
        18 * 3,
        16 * 3,
        0, //   8  100
        23 * 3,
        17 * 3,
        0, //   9  010
        27 * 3,
        25 * 3,
        0, //  10  110
        21 * 3,
        28 * 3,
        0, //  11  101
        15 * 3,
        22 * 3,
        0, //  12  000
        24 * 3,
        26 * 3,
        0, //  13  001
        0,
        0,
        60, //  14  111.
        35 * 3,
        40 * 3,
        0, //  15  0000
        44 * 3,
        48 * 3,
        0, //  16  1001
        38 * 3,
        36 * 3,
        0, //  17  0101
        42 * 3,
        47 * 3,
        0, //  18  1000
        29 * 3,
        31 * 3,
        0, //  19  0111
        39 * 3,
        32 * 3,
        0, //  20  0110
        0,
        0,
        32, //  21  1010.
        45 * 3,
        46 * 3,
        0, //  22  0001
        33 * 3,
        41 * 3,
        0, //  23  0100
        43 * 3,
        34 * 3,
        0, //  24  0010
        0,
        0,
        4, //  25  1101.
        30 * 3,
        37 * 3,
        0, //  26  0011
        0,
        0,
        8, //  27  1100.
        0,
        0,
        16, //  28  1011.
        0,
        0,
        44, //  29  0111 0.
        50 * 3,
        56 * 3,
        0, //  30  0011 0
        0,
        0,
        28, //  31  0111 1.
        0,
        0,
        52, //  32  0110 1.
        0,
        0,
        62, //  33  0100 0.
        61 * 3,
        59 * 3,
        0, //  34  0010 1
        52 * 3,
        60 * 3,
        0, //  35  0000 0
        0,
        0,
        1, //  36  0101 1.
        55 * 3,
        54 * 3,
        0, //  37  0011 1
        0,
        0,
        61, //  38  0101 0.
        0,
        0,
        56, //  39  0110 0.
        57 * 3,
        58 * 3,
        0, //  40  0000 1
        0,
        0,
        2, //  41  0100 1.
        0,
        0,
        40, //  42  1000 0.
        51 * 3,
        62 * 3,
        0, //  43  0010 0
        0,
        0,
        48, //  44  1001 0.
        64 * 3,
        63 * 3,
        0, //  45  0001 0
        49 * 3,
        53 * 3,
        0, //  46  0001 1
        0,
        0,
        20, //  47  1000 1.
        0,
        0,
        12, //  48  1001 1.
        80 * 3,
        83 * 3,
        0, //  49  0001 10
        0,
        0,
        63, //  50  0011 00.
        77 * 3,
        75 * 3,
        0, //  51  0010 00
        65 * 3,
        73 * 3,
        0, //  52  0000 00
        84 * 3,
        66 * 3,
        0, //  53  0001 11
        0,
        0,
        24, //  54  0011 11.
        0,
        0,
        36, //  55  0011 10.
        0,
        0,
        3, //  56  0011 01.
        69 * 3,
        87 * 3,
        0, //  57  0000 10
        81 * 3,
        79 * 3,
        0, //  58  0000 11
        68 * 3,
        71 * 3,
        0, //  59  0010 11
        70 * 3,
        78 * 3,
        0, //  60  0000 01
        67 * 3,
        76 * 3,
        0, //  61  0010 10
        72 * 3,
        74 * 3,
        0, //  62  0010 01
        86 * 3,
        85 * 3,
        0, //  63  0001 01
        88 * 3,
        82 * 3,
        0, //  64  0001 00
        -1,
        94 * 3,
        0, //  65  0000 000
        95 * 3,
        97 * 3,
        0, //  66  0001 111
        0,
        0,
        33, //  67  0010 100.
        0,
        0,
        9, //  68  0010 110.
        106 * 3,
        110 * 3,
        0, //  69  0000 100
        102 * 3,
        116 * 3,
        0, //  70  0000 010
        0,
        0,
        5, //  71  0010 111.
        0,
        0,
        10, //  72  0010 010.
        93 * 3,
        89 * 3,
        0, //  73  0000 001
        0,
        0,
        6, //  74  0010 011.
        0,
        0,
        18, //  75  0010 001.
        0,
        0,
        17, //  76  0010 101.
        0,
        0,
        34, //  77  0010 000.
        113 * 3,
        119 * 3,
        0, //  78  0000 011
        103 * 3,
        104 * 3,
        0, //  79  0000 111
        90 * 3,
        92 * 3,
        0, //  80  0001 100
        109 * 3,
        107 * 3,
        0, //  81  0000 110
        117 * 3,
        118 * 3,
        0, //  82  0001 001
        101 * 3,
        99 * 3,
        0, //  83  0001 101
        98 * 3,
        96 * 3,
        0, //  84  0001 110
        100 * 3,
        91 * 3,
        0, //  85  0001 011
        114 * 3,
        115 * 3,
        0, //  86  0001 010
        105 * 3,
        108 * 3,
        0, //  87  0000 101
        112 * 3,
        111 * 3,
        0, //  88  0001 000
        121 * 3,
        125 * 3,
        0, //  89  0000 0011
        0,
        0,
        41, //  90  0001 1000.
        0,
        0,
        14, //  91  0001 0111.
        0,
        0,
        21, //  92  0001 1001.
        124 * 3,
        122 * 3,
        0, //  93  0000 0010
        120 * 3,
        123 * 3,
        0, //  94  0000 0001
        0,
        0,
        11, //  95  0001 1110.
        0,
        0,
        19, //  96  0001 1101.
        0,
        0,
        7, //  97  0001 1111.
        0,
        0,
        35, //  98  0001 1100.
        0,
        0,
        13, //  99  0001 1011.
        0,
        0,
        50, // 100  0001 0110.
        0,
        0,
        49, // 101  0001 1010.
        0,
        0,
        58, // 102  0000 0100.
        0,
        0,
        37, // 103  0000 1110.
        0,
        0,
        25, // 104  0000 1111.
        0,
        0,
        45, // 105  0000 1010.
        0,
        0,
        57, // 106  0000 1000.
        0,
        0,
        26, // 107  0000 1101.
        0,
        0,
        29, // 108  0000 1011.
        0,
        0,
        38, // 109  0000 1100.
        0,
        0,
        53, // 110  0000 1001.
        0,
        0,
        23, // 111  0001 0001.
        0,
        0,
        43, // 112  0001 0000.
        0,
        0,
        46, // 113  0000 0110.
        0,
        0,
        42, // 114  0001 0100.
        0,
        0,
        22, // 115  0001 0101.
        0,
        0,
        54, // 116  0000 0101.
        0,
        0,
        51, // 117  0001 0010.
        0,
        0,
        15, // 118  0001 0011.
        0,
        0,
        30, // 119  0000 0111.
        0,
        0,
        39, // 120  0000 0001 0.
        0,
        0,
        47, // 121  0000 0011 0.
        0,
        0,
        55, // 122  0000 0010 1.
        0,
        0,
        27, // 123  0000 0001 1.
        0,
        0,
        59, // 124  0000 0010 0.
        0,
        0,
        31, // 125  0000 0011 1.
      ]),
      MOTION = new Int16Array([
        1 * 3,
        2 * 3,
        0, //   0
        4 * 3,
        3 * 3,
        0, //   1  0
        0,
        0,
        0, //   2  1.
        6 * 3,
        5 * 3,
        0, //   3  01
        8 * 3,
        7 * 3,
        0, //   4  00
        0,
        0,
        -1, //   5  011.
        0,
        0,
        1, //   6  010.
        9 * 3,
        10 * 3,
        0, //   7  001
        12 * 3,
        11 * 3,
        0, //   8  000
        0,
        0,
        2, //   9  0010.
        0,
        0,
        -2, //  10  0011.
        14 * 3,
        15 * 3,
        0, //  11  0001
        16 * 3,
        13 * 3,
        0, //  12  0000
        20 * 3,
        18 * 3,
        0, //  13  0000 1
        0,
        0,
        3, //  14  0001 0.
        0,
        0,
        -3, //  15  0001 1.
        17 * 3,
        19 * 3,
        0, //  16  0000 0
        -1,
        23 * 3,
        0, //  17  0000 00
        27 * 3,
        25 * 3,
        0, //  18  0000 11
        26 * 3,
        21 * 3,
        0, //  19  0000 01
        24 * 3,
        22 * 3,
        0, //  20  0000 10
        32 * 3,
        28 * 3,
        0, //  21  0000 011
        29 * 3,
        31 * 3,
        0, //  22  0000 101
        -1,
        33 * 3,
        0, //  23  0000 001
        36 * 3,
        35 * 3,
        0, //  24  0000 100
        0,
        0,
        -4, //  25  0000 111.
        30 * 3,
        34 * 3,
        0, //  26  0000 010
        0,
        0,
        4, //  27  0000 110.
        0,
        0,
        -7, //  28  0000 0111.
        0,
        0,
        5, //  29  0000 1010.
        37 * 3,
        41 * 3,
        0, //  30  0000 0100
        0,
        0,
        -5, //  31  0000 1011.
        0,
        0,
        7, //  32  0000 0110.
        38 * 3,
        40 * 3,
        0, //  33  0000 0011
        42 * 3,
        39 * 3,
        0, //  34  0000 0101
        0,
        0,
        -6, //  35  0000 1001.
        0,
        0,
        6, //  36  0000 1000.
        51 * 3,
        54 * 3,
        0, //  37  0000 0100 0
        50 * 3,
        49 * 3,
        0, //  38  0000 0011 0
        45 * 3,
        46 * 3,
        0, //  39  0000 0101 1
        52 * 3,
        47 * 3,
        0, //  40  0000 0011 1
        43 * 3,
        53 * 3,
        0, //  41  0000 0100 1
        44 * 3,
        48 * 3,
        0, //  42  0000 0101 0
        0,
        0,
        10, //  43  0000 0100 10.
        0,
        0,
        9, //  44  0000 0101 00.
        0,
        0,
        8, //  45  0000 0101 10.
        0,
        0,
        -8, //  46  0000 0101 11.
        57 * 3,
        66 * 3,
        0, //  47  0000 0011 11
        0,
        0,
        -9, //  48  0000 0101 01.
        60 * 3,
        64 * 3,
        0, //  49  0000 0011 01
        56 * 3,
        61 * 3,
        0, //  50  0000 0011 00
        55 * 3,
        62 * 3,
        0, //  51  0000 0100 00
        58 * 3,
        63 * 3,
        0, //  52  0000 0011 10
        0,
        0,
        -10, //  53  0000 0100 11.
        59 * 3,
        65 * 3,
        0, //  54  0000 0100 01
        0,
        0,
        12, //  55  0000 0100 000.
        0,
        0,
        16, //  56  0000 0011 000.
        0,
        0,
        13, //  57  0000 0011 110.
        0,
        0,
        14, //  58  0000 0011 100.
        0,
        0,
        11, //  59  0000 0100 010.
        0,
        0,
        15, //  60  0000 0011 010.
        0,
        0,
        -16, //  61  0000 0011 001.
        0,
        0,
        -12, //  62  0000 0100 001.
        0,
        0,
        -14, //  63  0000 0011 101.
        0,
        0,
        -15, //  64  0000 0011 011.
        0,
        0,
        -11, //  65  0000 0100 011.
        0,
        0,
        -13, //  66  0000 0011 111.
      ]),
      DCT_DC_SIZE_LUMINANCE = new Int8Array([
        2 * 3,
        1 * 3,
        0, //   0
        6 * 3,
        5 * 3,
        0, //   1  1
        3 * 3,
        4 * 3,
        0, //   2  0
        0,
        0,
        1, //   3  00.
        0,
        0,
        2, //   4  01.
        9 * 3,
        8 * 3,
        0, //   5  11
        7 * 3,
        10 * 3,
        0, //   6  10
        0,
        0,
        0, //   7  100.
        12 * 3,
        11 * 3,
        0, //   8  111
        0,
        0,
        4, //   9  110.
        0,
        0,
        3, //  10  101.
        13 * 3,
        14 * 3,
        0, //  11  1111
        0,
        0,
        5, //  12  1110.
        0,
        0,
        6, //  13  1111 0.
        16 * 3,
        15 * 3,
        0, //  14  1111 1
        17 * 3,
        -1,
        0, //  15  1111 11
        0,
        0,
        7, //  16  1111 10.
        0,
        0,
        8, //  17  1111 110.
      ]),
      DCT_DC_SIZE_CHROMINANCE = new Int8Array([
        2 * 3,
        1 * 3,
        0, //   0
        4 * 3,
        3 * 3,
        0, //   1  1
        6 * 3,
        5 * 3,
        0, //   2  0
        8 * 3,
        7 * 3,
        0, //   3  11
        0,
        0,
        2, //   4  10.
        0,
        0,
        1, //   5  01.
        0,
        0,
        0, //   6  00.
        10 * 3,
        9 * 3,
        0, //   7  111
        0,
        0,
        3, //   8  110.
        12 * 3,
        11 * 3,
        0, //   9  1111
        0,
        0,
        4, //  10  1110.
        14 * 3,
        13 * 3,
        0, //  11  1111 1
        0,
        0,
        5, //  12  1111 0.
        16 * 3,
        15 * 3,
        0, //  13  1111 11
        0,
        0,
        6, //  14  1111 10.
        17 * 3,
        -1,
        0, //  15  1111 111
        0,
        0,
        7, //  16  1111 110.
        0,
        0,
        8, //  17  1111 1110.
      ]),
      //  dct_coeff bitmap:
      //    0xff00  run
      //    0x00ff  level

      //  Decoded values are unsigned. Sign bit follows in the stream.

      //  Interpretation of the value 0x0001
      //    for dc_coeff_first:  run=0, level=1
      //    for dc_coeff_next:   If the next bit is 1: run=0, level=1
      //                         If the next bit is 0: end_of_block

      //  escape decodes as 0xffff.

      DCT_COEFF = new Int32Array([
        1 * 3,
        2 * 3,
        0, //   0
        4 * 3,
        3 * 3,
        0, //   1  0
        0,
        0,
        0x0001, //   2  1.
        7 * 3,
        8 * 3,
        0, //   3  01
        6 * 3,
        5 * 3,
        0, //   4  00
        13 * 3,
        9 * 3,
        0, //   5  001
        11 * 3,
        10 * 3,
        0, //   6  000
        14 * 3,
        12 * 3,
        0, //   7  010
        0,
        0,
        0x0101, //   8  011.
        20 * 3,
        22 * 3,
        0, //   9  0011
        18 * 3,
        21 * 3,
        0, //  10  0001
        16 * 3,
        19 * 3,
        0, //  11  0000
        0,
        0,
        0x0201, //  12  0101.
        17 * 3,
        15 * 3,
        0, //  13  0010
        0,
        0,
        0x0002, //  14  0100.
        0,
        0,
        0x0003, //  15  0010 1.
        27 * 3,
        25 * 3,
        0, //  16  0000 0
        29 * 3,
        31 * 3,
        0, //  17  0010 0
        24 * 3,
        26 * 3,
        0, //  18  0001 0
        32 * 3,
        30 * 3,
        0, //  19  0000 1
        0,
        0,
        0x0401, //  20  0011 0.
        23 * 3,
        28 * 3,
        0, //  21  0001 1
        0,
        0,
        0x0301, //  22  0011 1.
        0,
        0,
        0x0102, //  23  0001 10.
        0,
        0,
        0x0701, //  24  0001 00.
        0,
        0,
        0xffff, //  25  0000 01. -- escape
        0,
        0,
        0x0601, //  26  0001 01.
        37 * 3,
        36 * 3,
        0, //  27  0000 00
        0,
        0,
        0x0501, //  28  0001 11.
        35 * 3,
        34 * 3,
        0, //  29  0010 00
        39 * 3,
        38 * 3,
        0, //  30  0000 11
        33 * 3,
        42 * 3,
        0, //  31  0010 01
        40 * 3,
        41 * 3,
        0, //  32  0000 10
        52 * 3,
        50 * 3,
        0, //  33  0010 010
        54 * 3,
        53 * 3,
        0, //  34  0010 001
        48 * 3,
        49 * 3,
        0, //  35  0010 000
        43 * 3,
        45 * 3,
        0, //  36  0000 001
        46 * 3,
        44 * 3,
        0, //  37  0000 000
        0,
        0,
        0x0801, //  38  0000 111.
        0,
        0,
        0x0004, //  39  0000 110.
        0,
        0,
        0x0202, //  40  0000 100.
        0,
        0,
        0x0901, //  41  0000 101.
        51 * 3,
        47 * 3,
        0, //  42  0010 011
        55 * 3,
        57 * 3,
        0, //  43  0000 0010
        60 * 3,
        56 * 3,
        0, //  44  0000 0001
        59 * 3,
        58 * 3,
        0, //  45  0000 0011
        61 * 3,
        62 * 3,
        0, //  46  0000 0000
        0,
        0,
        0x0a01, //  47  0010 0111.
        0,
        0,
        0x0d01, //  48  0010 0000.
        0,
        0,
        0x0006, //  49  0010 0001.
        0,
        0,
        0x0103, //  50  0010 0101.
        0,
        0,
        0x0005, //  51  0010 0110.
        0,
        0,
        0x0302, //  52  0010 0100.
        0,
        0,
        0x0b01, //  53  0010 0011.
        0,
        0,
        0x0c01, //  54  0010 0010.
        76 * 3,
        75 * 3,
        0, //  55  0000 0010 0
        67 * 3,
        70 * 3,
        0, //  56  0000 0001 1
        73 * 3,
        71 * 3,
        0, //  57  0000 0010 1
        78 * 3,
        74 * 3,
        0, //  58  0000 0011 1
        72 * 3,
        77 * 3,
        0, //  59  0000 0011 0
        69 * 3,
        64 * 3,
        0, //  60  0000 0001 0
        68 * 3,
        63 * 3,
        0, //  61  0000 0000 0
        66 * 3,
        65 * 3,
        0, //  62  0000 0000 1
        81 * 3,
        87 * 3,
        0, //  63  0000 0000 01
        91 * 3,
        80 * 3,
        0, //  64  0000 0001 01
        82 * 3,
        79 * 3,
        0, //  65  0000 0000 11
        83 * 3,
        86 * 3,
        0, //  66  0000 0000 10
        93 * 3,
        92 * 3,
        0, //  67  0000 0001 10
        84 * 3,
        85 * 3,
        0, //  68  0000 0000 00
        90 * 3,
        94 * 3,
        0, //  69  0000 0001 00
        88 * 3,
        89 * 3,
        0, //  70  0000 0001 11
        0,
        0,
        0x0203, //  71  0000 0010 11.
        0,
        0,
        0x0104, //  72  0000 0011 00.
        0,
        0,
        0x0007, //  73  0000 0010 10.
        0,
        0,
        0x0402, //  74  0000 0011 11.
        0,
        0,
        0x0502, //  75  0000 0010 01.
        0,
        0,
        0x1001, //  76  0000 0010 00.
        0,
        0,
        0x0f01, //  77  0000 0011 01.
        0,
        0,
        0x0e01, //  78  0000 0011 10.
        105 * 3,
        107 * 3,
        0, //  79  0000 0000 111
        111 * 3,
        114 * 3,
        0, //  80  0000 0001 011
        104 * 3,
        97 * 3,
        0, //  81  0000 0000 010
        125 * 3,
        119 * 3,
        0, //  82  0000 0000 110
        96 * 3,
        98 * 3,
        0, //  83  0000 0000 100
        -1,
        123 * 3,
        0, //  84  0000 0000 000
        95 * 3,
        101 * 3,
        0, //  85  0000 0000 001
        106 * 3,
        121 * 3,
        0, //  86  0000 0000 101
        99 * 3,
        102 * 3,
        0, //  87  0000 0000 011
        113 * 3,
        103 * 3,
        0, //  88  0000 0001 110
        112 * 3,
        116 * 3,
        0, //  89  0000 0001 111
        110 * 3,
        100 * 3,
        0, //  90  0000 0001 000
        124 * 3,
        115 * 3,
        0, //  91  0000 0001 010
        117 * 3,
        122 * 3,
        0, //  92  0000 0001 101
        109 * 3,
        118 * 3,
        0, //  93  0000 0001 100
        120 * 3,
        108 * 3,
        0, //  94  0000 0001 001
        127 * 3,
        136 * 3,
        0, //  95  0000 0000 0010
        139 * 3,
        140 * 3,
        0, //  96  0000 0000 1000
        130 * 3,
        126 * 3,
        0, //  97  0000 0000 0101
        145 * 3,
        146 * 3,
        0, //  98  0000 0000 1001
        128 * 3,
        129 * 3,
        0, //  99  0000 0000 0110
        0,
        0,
        0x0802, // 100  0000 0001 0001.
        132 * 3,
        134 * 3,
        0, // 101  0000 0000 0011
        155 * 3,
        154 * 3,
        0, // 102  0000 0000 0111
        0,
        0,
        0x0008, // 103  0000 0001 1101.
        137 * 3,
        133 * 3,
        0, // 104  0000 0000 0100
        143 * 3,
        144 * 3,
        0, // 105  0000 0000 1110
        151 * 3,
        138 * 3,
        0, // 106  0000 0000 1010
        142 * 3,
        141 * 3,
        0, // 107  0000 0000 1111
        0,
        0,
        0x000a, // 108  0000 0001 0011.
        0,
        0,
        0x0009, // 109  0000 0001 1000.
        0,
        0,
        0x000b, // 110  0000 0001 0000.
        0,
        0,
        0x1501, // 111  0000 0001 0110.
        0,
        0,
        0x0602, // 112  0000 0001 1110.
        0,
        0,
        0x0303, // 113  0000 0001 1100.
        0,
        0,
        0x1401, // 114  0000 0001 0111.
        0,
        0,
        0x0702, // 115  0000 0001 0101.
        0,
        0,
        0x1101, // 116  0000 0001 1111.
        0,
        0,
        0x1201, // 117  0000 0001 1010.
        0,
        0,
        0x1301, // 118  0000 0001 1001.
        148 * 3,
        152 * 3,
        0, // 119  0000 0000 1101
        0,
        0,
        0x0403, // 120  0000 0001 0010.
        153 * 3,
        150 * 3,
        0, // 121  0000 0000 1011
        0,
        0,
        0x0105, // 122  0000 0001 1011.
        131 * 3,
        135 * 3,
        0, // 123  0000 0000 0001
        0,
        0,
        0x0204, // 124  0000 0001 0100.
        149 * 3,
        147 * 3,
        0, // 125  0000 0000 1100
        172 * 3,
        173 * 3,
        0, // 126  0000 0000 0101 1
        162 * 3,
        158 * 3,
        0, // 127  0000 0000 0010 0
        170 * 3,
        161 * 3,
        0, // 128  0000 0000 0110 0
        168 * 3,
        166 * 3,
        0, // 129  0000 0000 0110 1
        157 * 3,
        179 * 3,
        0, // 130  0000 0000 0101 0
        169 * 3,
        167 * 3,
        0, // 131  0000 0000 0001 0
        174 * 3,
        171 * 3,
        0, // 132  0000 0000 0011 0
        178 * 3,
        177 * 3,
        0, // 133  0000 0000 0100 1
        156 * 3,
        159 * 3,
        0, // 134  0000 0000 0011 1
        164 * 3,
        165 * 3,
        0, // 135  0000 0000 0001 1
        183 * 3,
        182 * 3,
        0, // 136  0000 0000 0010 1
        175 * 3,
        176 * 3,
        0, // 137  0000 0000 0100 0
        0,
        0,
        0x0107, // 138  0000 0000 1010 1.
        0,
        0,
        0x0a02, // 139  0000 0000 1000 0.
        0,
        0,
        0x0902, // 140  0000 0000 1000 1.
        0,
        0,
        0x1601, // 141  0000 0000 1111 1.
        0,
        0,
        0x1701, // 142  0000 0000 1111 0.
        0,
        0,
        0x1901, // 143  0000 0000 1110 0.
        0,
        0,
        0x1801, // 144  0000 0000 1110 1.
        0,
        0,
        0x0503, // 145  0000 0000 1001 0.
        0,
        0,
        0x0304, // 146  0000 0000 1001 1.
        0,
        0,
        0x000d, // 147  0000 0000 1100 1.
        0,
        0,
        0x000c, // 148  0000 0000 1101 0.
        0,
        0,
        0x000e, // 149  0000 0000 1100 0.
        0,
        0,
        0x000f, // 150  0000 0000 1011 1.
        0,
        0,
        0x0205, // 151  0000 0000 1010 0.
        0,
        0,
        0x1a01, // 152  0000 0000 1101 1.
        0,
        0,
        0x0106, // 153  0000 0000 1011 0.
        180 * 3,
        181 * 3,
        0, // 154  0000 0000 0111 1
        160 * 3,
        163 * 3,
        0, // 155  0000 0000 0111 0
        196 * 3,
        199 * 3,
        0, // 156  0000 0000 0011 10
        0,
        0,
        0x001b, // 157  0000 0000 0101 00.
        203 * 3,
        185 * 3,
        0, // 158  0000 0000 0010 01
        202 * 3,
        201 * 3,
        0, // 159  0000 0000 0011 11
        0,
        0,
        0x0013, // 160  0000 0000 0111 00.
        0,
        0,
        0x0016, // 161  0000 0000 0110 01.
        197 * 3,
        207 * 3,
        0, // 162  0000 0000 0010 00
        0,
        0,
        0x0012, // 163  0000 0000 0111 01.
        191 * 3,
        192 * 3,
        0, // 164  0000 0000 0001 10
        188 * 3,
        190 * 3,
        0, // 165  0000 0000 0001 11
        0,
        0,
        0x0014, // 166  0000 0000 0110 11.
        184 * 3,
        194 * 3,
        0, // 167  0000 0000 0001 01
        0,
        0,
        0x0015, // 168  0000 0000 0110 10.
        186 * 3,
        193 * 3,
        0, // 169  0000 0000 0001 00
        0,
        0,
        0x0017, // 170  0000 0000 0110 00.
        204 * 3,
        198 * 3,
        0, // 171  0000 0000 0011 01
        0,
        0,
        0x0019, // 172  0000 0000 0101 10.
        0,
        0,
        0x0018, // 173  0000 0000 0101 11.
        200 * 3,
        205 * 3,
        0, // 174  0000 0000 0011 00
        0,
        0,
        0x001f, // 175  0000 0000 0100 00.
        0,
        0,
        0x001e, // 176  0000 0000 0100 01.
        0,
        0,
        0x001c, // 177  0000 0000 0100 11.
        0,
        0,
        0x001d, // 178  0000 0000 0100 10.
        0,
        0,
        0x001a, // 179  0000 0000 0101 01.
        0,
        0,
        0x0011, // 180  0000 0000 0111 10.
        0,
        0,
        0x0010, // 181  0000 0000 0111 11.
        189 * 3,
        206 * 3,
        0, // 182  0000 0000 0010 11
        187 * 3,
        195 * 3,
        0, // 183  0000 0000 0010 10
        218 * 3,
        211 * 3,
        0, // 184  0000 0000 0001 010
        0,
        0,
        0x0025, // 185  0000 0000 0010 011.
        215 * 3,
        216 * 3,
        0, // 186  0000 0000 0001 000
        0,
        0,
        0x0024, // 187  0000 0000 0010 100.
        210 * 3,
        212 * 3,
        0, // 188  0000 0000 0001 110
        0,
        0,
        0x0022, // 189  0000 0000 0010 110.
        213 * 3,
        209 * 3,
        0, // 190  0000 0000 0001 111
        221 * 3,
        222 * 3,
        0, // 191  0000 0000 0001 100
        219 * 3,
        208 * 3,
        0, // 192  0000 0000 0001 101
        217 * 3,
        214 * 3,
        0, // 193  0000 0000 0001 001
        223 * 3,
        220 * 3,
        0, // 194  0000 0000 0001 011
        0,
        0,
        0x0023, // 195  0000 0000 0010 101.
        0,
        0,
        0x010b, // 196  0000 0000 0011 100.
        0,
        0,
        0x0028, // 197  0000 0000 0010 000.
        0,
        0,
        0x010c, // 198  0000 0000 0011 011.
        0,
        0,
        0x010a, // 199  0000 0000 0011 101.
        0,
        0,
        0x0020, // 200  0000 0000 0011 000.
        0,
        0,
        0x0108, // 201  0000 0000 0011 111.
        0,
        0,
        0x0109, // 202  0000 0000 0011 110.
        0,
        0,
        0x0026, // 203  0000 0000 0010 010.
        0,
        0,
        0x010d, // 204  0000 0000 0011 010.
        0,
        0,
        0x010e, // 205  0000 0000 0011 001.
        0,
        0,
        0x0021, // 206  0000 0000 0010 111.
        0,
        0,
        0x0027, // 207  0000 0000 0010 001.
        0,
        0,
        0x1f01, // 208  0000 0000 0001 1011.
        0,
        0,
        0x1b01, // 209  0000 0000 0001 1111.
        0,
        0,
        0x1e01, // 210  0000 0000 0001 1100.
        0,
        0,
        0x1002, // 211  0000 0000 0001 0101.
        0,
        0,
        0x1d01, // 212  0000 0000 0001 1101.
        0,
        0,
        0x1c01, // 213  0000 0000 0001 1110.
        0,
        0,
        0x010f, // 214  0000 0000 0001 0011.
        0,
        0,
        0x0112, // 215  0000 0000 0001 0000.
        0,
        0,
        0x0111, // 216  0000 0000 0001 0001.
        0,
        0,
        0x0110, // 217  0000 0000 0001 0010.
        0,
        0,
        0x0603, // 218  0000 0000 0001 0100.
        0,
        0,
        0x0b02, // 219  0000 0000 0001 1010.
        0,
        0,
        0x0e02, // 220  0000 0000 0001 0111.
        0,
        0,
        0x0d02, // 221  0000 0000 0001 1000.
        0,
        0,
        0x0c02, // 222  0000 0000 0001 1001.
        0,
        0,
        0x0f02, // 223  0000 0000 0001 0110.
      ]),
      PICTURE_TYPE_I = 1,
      PICTURE_TYPE_P = 2,
      PICTURE_TYPE_B = 3,
      PICTURE_TYPE_D = 4,
      START_SEQUENCE = 0xb3,
      START_SLICE_FIRST = 0x01,
      START_SLICE_LAST = 0xaf,
      START_PICTURE = 0x00,
      START_EXTENSION = 0xb5,
      START_USER_DATA = 0xb2,
      START_PACKET_VIDEO = 0xfa,
      START_PACKET_AUDIO = 0xfb,
      // Shaders for accelerated WebGL YCbCrToRGBA conversion
      SHADER_FRAGMENT_YCBCRTORGBA = [
        "precision mediump float;",
        "uniform sampler2D YTexture;",
        "uniform sampler2D CBTexture;",
        "uniform sampler2D CRTexture;",
        "varying vec2 texCoord;",

        "void main() {",
        "float y = texture2D(YTexture, texCoord).r;",
        "float cr = texture2D(CBTexture, texCoord).r - 0.5;",
        "float cb = texture2D(CRTexture, texCoord).r - 0.5;",

        "gl_FragColor = vec4(",
        "y + 1.4 * cr,",
        "y + -0.343 * cb - 0.711 * cr,",
        "y + 1.765 * cb,",
        "1.0",
        ");",
        "}",
      ].join("\n"),
      SHADER_FRAGMENT_LOADING = [
        "precision mediump float;",
        "uniform float loaded;",
        "varying vec2 texCoord;",

        "void main() {",
        "float c = ceil(loaded-(1.0-texCoord.y));",
        //'float c = ceil(loaded-(1.0-texCoord.y) +sin((texCoord.x+loaded)*16.0)*0.01);', // Fancy wave anim
        "gl_FragColor = vec4(c,c,c,1);",
        "}",
      ].join("\n"),
      SHADER_VERTEX_IDENTITY = [
        "attribute vec2 vertex;",
        "varying vec2 texCoord;",

        "void main() {",
        "texCoord = vertex;",
        "gl_Position = vec4((vertex * 2.0 - 1.0) * vec2(1, 1), 0.0, 1.0);",
        "}",
      ].join("\n")

    var MACROBLOCK_TYPE_TABLES = [
      null,
      MACROBLOCK_TYPE_I,
      MACROBLOCK_TYPE_P,
      MACROBLOCK_TYPE_B,
    ]

    // ----------------------------------------------------------------------------
    // Bit Reader

    var BitReader = function(arrayBuffer) {
      this.bytes =
        arrayBuffer instanceof Uint8Array
          ? arrayBuffer
          : new Uint8Array(arrayBuffer)
      this.length = this.bytes.length
      this.writePos = this.bytes.length
      this.index = 0
    }

    BitReader.NOT_FOUND = -1

    BitReader.prototype.findNextMPEGStartCode = function() {
      for (var i = (this.index + 7) >> 3; i < this.writePos; i++) {
        if (
          this.bytes[i] == 0x00 &&
          this.bytes[i + 1] == 0x00 &&
          this.bytes[i + 2] == 0x01
        ) {
          this.index = (i + 4) << 3
          return this.bytes[i + 3]
        }
      }
      this.index = this.writePos << 3
      return BitReader.NOT_FOUND
    }

    BitReader.prototype.nextBytesAreStartCode = function() {
      var i = (this.index + 7) >> 3
      return (
        i >= this.writePos ||
        (this.bytes[i] == 0x00 &&
          this.bytes[i + 1] == 0x00 &&
          this.bytes[i + 2] == 0x01)
      )
    }

    BitReader.prototype.nextBits = function(count) {
      var byteOffset = this.index >> 3,
        room = 8 - this.index % 8

      if (room >= count) {
        return (
          (this.bytes[byteOffset] >> (room - count)) &
          (0xff >> (8 - count))
        )
      }

      var leftover = (this.index + count) % 8, // Leftover bits in last byte
        end = (this.index + count - 1) >> 3,
        value = this.bytes[byteOffset] & (0xff >> (8 - room)) // Fill out first byte

      for (byteOffset++; byteOffset < end; byteOffset++) {
        value <<= 8 // Shift and
        value |= this.bytes[byteOffset] // Put next byte
      }

      if (leftover > 0) {
        value <<= leftover // Make room for remaining bits
        value |= this.bytes[byteOffset] >> (8 - leftover)
      } else {
        value <<= 8
        value |= this.bytes[byteOffset]
      }

      return value
    }
    BitReader.prototype.peek = BitReader.prototype.nextBits

    BitReader.prototype.getBits = function(count) {
      var value = this.nextBits(count)
      this.index += count
      return value
    }
    BitReader.prototype.read = BitReader.prototype.getBits

    BitReader.prototype.align = function() {
      this.index = (((this.index + 7) / 8) | 0) * 8
    }

    BitReader.prototype.advance = function(count) {
      return (this.index += count)
    }

    BitReader.prototype.rewind = function(count) {
      return (this.index -= count)
    }

    window.BitReader = BitReader
  })(window)

  function connect(gl, address, ffmpegOptions) {
    GL = gl

    var client, player

    if (!ffmpegOptions || !address) {
      throw new Error("Missing args")
    }

    isBigScreen = true
    if (address === "10.0.1.7"||address === "10.0.1.3") {
    }

    reconnectInProgress = false

    client = new WebSocket(`ws://${address}/ws`)
    player = new window.jsmpeg(client)
    player.address = address

    //    startStream(Object.assign({}, ffmpegOptions, { w: W, h: H }))

    console.log(this.address, "CONNECTED", address)
    window.player = player

    return {
      client,
      player,
    }
  }

  return {
    connect: connect,
  }
}
