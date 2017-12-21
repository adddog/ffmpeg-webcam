const readline = require("readline")
readline.emitKeypressEvents(process.stdin)
process.stdin.setRawMode(true)
const raf = require("raf")
var toBuffer = require("typedarray-to-buffer")
const fluentFF = require("fluent-ffmpeg")
const ffmpeg = require("./lib/ffmpeg")
const FB = require("./lib/fb")
const GL = require("./lib/gl")
const BITRATE_A = 140
const BITRATE_V = 400
const FPS = 30
/*const WIDTH = 640
const HEIGHT = 480*/
const WIDTH = 352
const HEIGHT = 288
//!!!!!!!!
const OFFLINE = true
//!!!!!!!!
const FB_PRIVACY = "private"
//SAM
const FB_ACCESS_TOKEN =
  "EAAXiyxq1MwkBAOg8Qi5h17SIPtgkG0dfiFxn0u5kjTqC2YVNtZC9Cnd8lVWsmIZB3P4xmccCPpZB9XhKe1MC7yOTXmhL96xkgkB4GAZBiwiQkR4FNbVkKbZBydJ2zdSYVUFOQhsy6FtNh66HYTKz1ys74Oa4vPSEZD"
//DAD
// const FB_ACCESS_TOKEN =
//   "EAAXiyxq1MwkBAChJIEEIgdKLVCEwMNJv068D4Cfmy0zcoE3ZCml9wJ7RZBkttxPMyMD3IAjiEgOPbo4cbPWxhHAMfguKSA2Ad3jShq17EchLxaMnuZCXBLeAJ32XxgXfPbBtSxhzIxqQjRy5B9ZBqIsXjEd6fL8ZD"

const TCP = false
const TCP_STREAM_NAME = "/webcam"

var now = require("performance-now")
const WebcamWebsocket = require("./index")
const WEBCAM_IPS = ["10.0.1.9", "10.0.1.3"] //, "10.0.1.3"
const WEBCAM_IP = "10.0.1.7"
const WEBCAM_IP_2 = "10.0.1.9"
const STREAM_IP = "10.0.1.8"
const STREAM_PORT = "1337"
const web = WebcamWebsocket()

let FFMPEG
function startStream(options) {
  let maxrate = options.maxrate || 600
  console.log(
    options.output || `"udp://${options.ip}:${options.port}"`
  )

  FFMPEG = ffmpeg({
    ...options,
    w: options.w,
    h: options.h,
    output: options.output,
    options: [`${options.options || ""} `],

    /*

    */
  })
}

/*const ff2 = web.connect(GL, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})*/

const GL_UNIFORMS = {
  slope: 0.1,
  tolerance: 0.5,
  trailIndex: 0,
  trailAmount: .9,
  keyIndex: 1,
  keyColor: [0, 0, 0],
  uSaturations: [1, 1, 1, 1],

  selectionIndex: 0,
}

const gl = GL({
  width: WIDTH,
  height: HEIGHT,
})

const feedback = gl.regl.texture()

const connections = WEBCAM_IPS.map(ip =>
  web.connect(gl, ip, {
    ip: STREAM_IP,
    port: "1337",
  })
)

var _t = now().toFixed(3)
var handle = raf(function tick() {
  var start = now().toFixed(3)

  if (start - _t >= 22 && FFMPEG) {
    //&& ff2.player.outBuffer

    if (WEBCAM_IPS.length == 1) {
      if (connections[0].player.outBuffer) {
        gl.drawSingle({
          tex0: connections[0].player.pixels,
        })
        FFMPEG.frame(toBuffer(gl.read(WIDTH, HEIGHT)))
      }
    } else if (WEBCAM_IPS.length == 2) {
      if (
        connections[0].player.outBuffer &&
        connections[1].player.outBuffer
      ) {
        //console.log(ff2.player.outBuffer.buffer);
        /*return gl.read(new Uint8Array(WIDTH * HEIGHT * 4))

      renderWebgl(ff.player.outBuffer, ff2.player.outBuffer)
      var pixels = new Uint8Array(W * H * 4)
      GL.readPixels(0, 0, W, H, GL.RGBA, GL.UNSIGNED_BYTE, pixels)*/
        //FFMPEG.frame(toBuffer(ff2.player.outBuffer))
        gl.mergeStreams({
          tex0: connections[0].player.pixels,
          tex1: connections[1].player.pixels,
          feedback: feedback,
          slope: GL_UNIFORMS.slope,
          tolerance: GL_UNIFORMS.tolerance,
          trailAmount: GL_UNIFORMS.trailAmount,
          keyIndex: GL_UNIFORMS.keyIndex,
          trailIndex:GL_UNIFORMS.trailIndex,
          keyColor: GL_UNIFORMS.keyColor,
          uSaturations: GL_UNIFORMS.uSaturations,
        })
        feedback({
          copy: true,
        })
        FFMPEG.frame(toBuffer(gl.read(WIDTH, HEIGHT)))
      }
    }
    _t = start
  }
  raf(tick)
})

/*const ff = web.connect(gl, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})
*/

const startFFMPEG = rtmpUrl => {
  const _videoBitrate = ` -preset ultrafast -tune zerolatency  -b:v ${BITRATE_V}k -minrate ${BITRATE_V /
    2}k  -maxrate ${BITRATE_V}k  -bufsize ${BITRATE_V * 2}k`

  //-fflags nobuffer
const _framerate = `-g ${Math.round(FPS * 4)} -r ${FPS} -framerate ${FPS} `
  const _options = OFFLINE
    ? `${TCP
        ? " -acodec aac -strict -2 -ar 48000 -ab 96k " //TCP
        : ""} ${_framerate} ${TCP ? "" : " "} `


    : ` -b:a ${BITRATE_A}k -c:v libx264 -pix_fmt yuv420p ${_framerate}`

  const _format = OFFLINE ? `${TCP ? "" : " -f mpegts"} ` : ` -f flv `

  const _audioInput = OFFLINE
    ? ["-f", "lavfi", "-i", "anullsrc", "-framerate", FPS]
    : ["-y", "-f", "avfoundation", "-i", ":3", "-framerate", FPS]
  startStream(
    Object.assign(
      {},
      {
        //input: [],
        input: _audioInput,
        // input: OFFLINE
        //   ? null
        //   : ["-y", "-f", "avfoundation", "-i", ":3"],
        //input: ["-f", "alsa", "-ac", "1", "-ar", "44100" ,"-i", "hw:3"],
        //input: ["-i", "hw:1,0","-f alsa", "-ac", "2",],
        options: `${_options} ${_videoBitrate} ${_format}`,
        //output: `"rtmp://a.rtmp.youtube.com/live2/f5v7-kfmq-27ce-9dft"`, //`"${rtmpUrl}"`,
        output: OFFLINE
          ? `${TCP
              ? `"http://127.0.0.1:8080${TCP_STREAM_NAME}.ffm"` //TCP
              : `"udp://${STREAM_IP}:${STREAM_PORT}"`}`
          : `"${rtmpUrl}"`,
      },
      { w: WIDTH, h: HEIGHT }
    )
  )
}

function start() {
  if (OFFLINE) {
    startFFMPEG()
  } else {
    var privacys = {
      public: "{'value':'EVERYONE'}",
      friends: "{'value':'ALL_FRIENDS'}",
      friends_of_friends: "{'value':'FRIENDS_OF_FRIENDS'}",
      private: null,
    }
    FB.startLiveVideo({
      accessToken: FB_ACCESS_TOKEN,
      title: "Live Video",
      privacy: privacys[FB_PRIVACY],
      /*privacy:
        privacys["public"] ||
        "{'value':'CUSTOM',allow:'100009508046151,1751806573'}",*/
    })
      .then(liveVideo => {
        var rtmpUrl = liveVideo.stream_url
        FB.postId = liveVideo.id

        startFFMPEG(rtmpUrl)
      })
      .catch(error => {
        console.error(error.message, error.options)
      })
  }
}

start()
// Start the keypress listener for the process
process.stdin.on("keypress", (str, key) => {
  console.log(key.name)
  switch (key.name) {
    case "q":
      GL_UNIFORMS.tolerance = Math.min(
        GL_UNIFORMS.tolerance + 0.05,
        1
      )
      break
    case "a":
      GL_UNIFORMS.tolerance = Math.max(
        GL_UNIFORMS.tolerance - 0.05,
        0
      )
      break
    case "w":
      GL_UNIFORMS.slope = Math.min(GL_UNIFORMS.slope + 0.05, 1)
      break
    case "s":
      GL_UNIFORMS.slope = Math.max(GL_UNIFORMS.slope - 0.05, 0)
      break

    case "t":
      GL_UNIFORMS.keyColor = GL_UNIFORMS.keyColor.map(c =>
        Math.min(c + 0.05, 1)
      )
      break
    case "g":
      GL_UNIFORMS.keyColor = GL_UNIFORMS.keyColor.map(c =>
        Math.max(c - 0.05, 0)
      )
      break

    case "y":
      GL_UNIFORMS.uSaturations[GL_UNIFORMS.selectionIndex] = Math.min(
        GL_UNIFORMS.uSaturations[GL_UNIFORMS.selectionIndex] + 0.05,
        4
      )
      break
    case "h":
      GL_UNIFORMS.uSaturations[GL_UNIFORMS.selectionIndex] = Math.max(
        GL_UNIFORMS.uSaturations[GL_UNIFORMS.selectionIndex] - 0.05,
        0
      )
      break

    case "i":
      GL_UNIFORMS.keyIndex = GL_UNIFORMS.keyIndex === 0 ? 1 : 0
      break
    case "k":
      GL_UNIFORMS.trailIndex = GL_UNIFORMS.trailIndex === 0 ? 1 : 0
      break

    case "o":
      GL_UNIFORMS.trailAmount = Math.min(GL_UNIFORMS.trailAmount + 0.05, 1)
      break
    case "l":
      GL_UNIFORMS.trailAmount = Math.max(GL_UNIFORMS.trailAmount - 0.05, 0)
      break

    case "space":
      GL_UNIFORMS.selectionIndex =
        (GL_UNIFORMS.selectionIndex + 1) % WEBCAM_IPS.length
      break
    case "escape":
      FB.endLiveVideo({
        postId: FB.postId,
        accessToken: FB_ACCESS_TOKEN,
      })
      FFMPEG.end()
      break
  }

  console.log("----Keys ----")
  console.log(`q - (a) is tolerance`)
  console.log(`w - (s) is slope`)
  console.log(`t - (g) is color`)
  console.log(`i is invert`)
  console.log("\n")
  console.log("GL_UNIFORMS-----")
  console.log(GL_UNIFORMS)
  console.log("\n")

  // "Raw" mode so we must do our own kill switch
  if (key.sequence === "\u0003") {
    process.exit()
  }

  // User has triggered a keypress, now do whatever we want!
  // ...
})

const extra = fluentFF("gd.mp4").native()
extra.on("data", function(chunk) {
  console.log("ffmpeg just wrote " + chunk.length + " bytes")
})

//initWebgl()

//startStream(Object.assign({}, ffmpegOptions, { w: W, h: H }))
