var cp = require("child_process")
var spawnSync = require("child_process").spawnSync
var toArrayBuffer = require("to-array-buffer")
var spawn = require("child_process").spawn
var spawnSync = require("child_process").spawnSync
var tou8 = require("buffer-to-uint8array")
var randomWord = require("random-word")
const fs = require("fs")
const raf = require("raf")
var toBuffer = require("typedarray-to-buffer")
const ffmpeg = require("./lib/ffmpeg")
const WebcamWebsocket = require("./lib/webcam-websocket-regl")
const WebcamWebsocketLegacy = require("./lib/webcam-websocket-legacy-regl")
const FB = require("./lib/fb")
const GL = require("./lib/gl")
const KEYBOARD = require("./lib/keyboard")
const VIDEO_OVERLAYS = require("./lib/video_overlays")
const BITRATE_A = 128
const BITRATE_V = 600
const FPS = 30
/*const WIDTH = 640
const HEIGHT = 480*/
const WIDTH = 352
const HEIGHT = 288
const AUDIO_INPUT_CHANNEL = ":3"
const VIDEO_DIR = "_used"
//!!!!!!!!
const USE_OMX = false
const PIPE_FFPLAY = false
const NO_OVERLAY_VIDEO = true
const SAVE_TO_VIDEO = false
const OFFLINE = true
const NO_AUDIO = true
const IS_PRIVATE = true
//!!!!!!!!
const FB_PRIVACY = IS_PRIVATE ? "private" : "public"
//SAM
const FB_ACCESS_TOKEN =
  "EAAXiyxq1MwkBAHI8Ydcaa0kDVDLnJlkmY751RVd3thLpwtoKqhKWhavwvPHoUyMh6YvQgR9Q8hxciR07BnrhAOGWHODghvEIkM3qO8N9gqXUq1mGMLWk58hRZBGHJ5fv6RmppKRVszXEktgeUCTzwi8O0hTsUXXkrYSqq0AZDZD"

const TCP = false
const TCP_STREAM_NAME = "/webcam"

var now = require("performance-now")

const WEBCAM_IPS = ["192.168.1.76"] //, "10.0.1.3"//, "10.0.1.7"
const STREAM_IP = "192.168.1.134"
const STREAM_PORT = "1337"
const web = WebcamWebsocketLegacy()

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
  })
}

/*const ff2 = web.connect(GL, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})*/

const GL_UNIFORMS = {
  ...JSON.parse(fs.readFileSync("settings_backup.json", "utf-8")),
  ...JSON.parse(fs.readFileSync("settings.json", "utf-8")),
}

const gl = GL({
  width: WIDTH,
  height: HEIGHT,
})

const feedback = gl.regl.texture()

var _ccc = 0

const IMG_COMMAND = [
  "-depth",
  "8",
  "-size",
  `${WIDTH}x${HEIGHT}`,
  "rgba:-",
  "PNG24:-",
]
const convertFast = (buffer, args = IMG_COMMAND, callback) => {
  var magick = spawnSync("convert", args, { input: buffer })
  callback(magick.output[1])
}

let _free = true
const connections = WEBCAM_IPS.map(ip =>
  web.connect(
    gl,
    ip,
    {
      ip: STREAM_IP,
      port: STREAM_PORT,
    },
    () => {
      /* gl.drawSingleNoOverlay({
        tex0: connections[0].player.pixels,
      });*/
      //var b = toBuffer(gl.read(WIDTH, HEIGHT));
      /*if (_ccc > 0) {
        fs.writeFile(
          `${_ccc}.jpeg`,
          jpeg.encode(
            {
              data: b,
              width: WIDTH,
              height: HEIGHT,
            },
            50
          ).data,
          "base64",
          err => {}
        );
      }*/
      if (_ccc > 140) {
        //FFMPEG.end();
        //process.exit();
      }
      //fs.writeFileSync(`${_ccc}.rgba`, Buffer.from(gl.read(WIDTH, HEIGHT)))
      _ccc++
      if (_free) {
        _free = false
        convertFast(
          Buffer.from(gl.read(WIDTH, HEIGHT)),
          IMG_COMMAND,
          jpeg => {
            //fs.writeFileSync(`${_ccc}.png`, jpeg)
            //console.log(jpeg);
            setTimeout(function(){
              FFMPEG.frame(jpeg)
              _free = true
            }, 10)
          }
        )
      }
    }
  )
)

let VIDEO_TEX
let videoOverlays
if (!NO_OVERLAY_VIDEO) {
  VIDEO_TEX = gl.regl.texture()
  videoOverlays = VIDEO_OVERLAYS(VIDEO_TEX, {
    dir: `_videos/${VIDEO_DIR}`,
  })
}

var _t = now().toFixed(3)

var handle = raf(function tick() {
  return
  var start = now().toFixed(3)

  if (start - _t >= 22 && FFMPEG) {
    //&& ff2.player.outBuffer

    if (WEBCAM_IPS.length == 1) {
      if (connections[0].player.outBuffer) {
        if (NO_OVERLAY_VIDEO) {
          gl.drawSingleNoOverlay({
            tex0: connections[0].player.pixels,
          })
        } else {
          gl.drawSingle({
            tex0: connections[0].player.pixels,
            overlay: VIDEO_TEX,
          })
        }
        //FFMPEG.frame(toBuffer(gl.read(WIDTH, HEIGHT)));
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
          overlay: VIDEO_TEX,
          keySlope: GL_UNIFORMS.keySlope,
          keyTolerance: GL_UNIFORMS.keyTolerance,
          overlayKeySlope: GL_UNIFORMS.overlayKeySlope,
          overlayKeyTolerance: GL_UNIFORMS.overlayKeyTolerance,
          overlayKeyColor: GL_UNIFORMS.overlayKeyColor,
          overlayContrast: GL_UNIFORMS.overlayContrast,
          overlaySaturation: GL_UNIFORMS.overlaySaturation,
          overlayColorMix: GL_UNIFORMS.overlayColorMix,
          overlaySelectionIndex: GL_UNIFORMS.overlaySelectionIndex,
          overlayTone: GL_UNIFORMS.overlayTone,
          pulseAmount: GL_UNIFORMS.pulseAmount,
          trailAmount: GL_UNIFORMS.trailAmount,
          keyIndex: GL_UNIFORMS.keyIndex,
          trailIndex: GL_UNIFORMS.trailIndex,
          keyColor: GL_UNIFORMS.keyColor,
          uSaturations: GL_UNIFORMS.uSaturations,
          uBrightnesses: GL_UNIFORMS.uBrightnesses,
          uContrasts: GL_UNIFORMS.uContrasts,
        })
        feedback({
          copy: true,
        })
        FFMPEG.frame(toBuffer(gl.read(WIDTH, HEIGHT)))
      }
    } else {
    }
    _t = start
    console.log(_t)
  }
  raf(tick)
})

/*const ff = web.connect(gl, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})
*/

const startFFMPEG = rtmpUrl => {
  const _videoBitrate = ` -movflags +faststart  -preset ultrafast -tune zerolatency -c:v libx264 -b:v ${BITRATE_V}k -minrate ${BITRATE_V /
    2}k  -maxrate ${BITRATE_V}k -bufsize ${BITRATE_V * 2}k ${
    NO_AUDIO
      ? " -an -analyzeduration 256 -probesize 64"
      : " -analyzeduration 1024 -probesize 512 "
  }`

  //-fflags nobuffer
  const _framerate = `-g ${Math.round(
    FPS * 2
  )} -r ${FPS} -framerate ${FPS} `

  const _options = OFFLINE
    ? `${
        TCP
          ? " -acodec aac -strict -2 -ar 48000 -ab 96k " //TCP
          : `${
              USE_OMX
                ? "-an -c:v libx264 -pix_fmt yuv420p"
                : `-b:a ${BITRATE_A}k`
            }`
      } ${_framerate} `
    : ` ${
        USE_OMX
          ? "-an -c:v libx264 -pix_fmt yuv420p"
          : `-b:a ${BITRATE_A}k`
      } -c:v libx264 -pix_fmt yuv420p ${_framerate}`

  const _format = OFFLINE
    ? `${TCP ? "" : `${USE_OMX ? "-f mpegts" : " -f mpegts"}`} `
    : ` -f flv `

  const _audioInput = NO_AUDIO
    ? []
    : OFFLINE
      ? [
          "-y",
          "-f",
          "avfoundation",
          "-i",
          AUDIO_INPUT_CHANNEL,
          "-framerate",
          FPS,
        ]
      : [
          "-y",
          "-f",
          "avfoundation",
          "-i",
          AUDIO_INPUT_CHANNEL,
          "-framerate",
          FPS,
        ]

  let output = PIPE_FFPLAY
    ? ` - | ${
        USE_OMX
          ? "omxplayer -b -r --no-keys -s -I -z --timeout 60 --live -o hdmi pipe:0"
          : "ffplay -"
      }`
    : OFFLINE
      ? `${
          TCP
            ? `"http://127.0.0.1:8080${TCP_STREAM_NAME}.ffm"` //TCP
            : `"udp://${STREAM_IP}:${STREAM_PORT}"`
        }`
      : `"${rtmpUrl}"`

  if (SAVE_TO_VIDEO) {
    output = `-y test.mp4`
  }

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
        //options: `${_options} ${_videoBitrate} ${_format}`,
        //output: `"rtmp://a.rtmp.youtube.com/live2/f5v7-kfmq-27ce-9dft"`, //`"${rtmpUrl}"`,
        output: output,
      },
      { w: WIDTH, h: HEIGHT }
    )
  )

  const keyboard = KEYBOARD({
    GL_UNIFORMS,
    FB,
    FB_ACCESS_TOKEN,
    FFMPEG,
    WEBCAM_IPS,
  })
}

function start() {
  if (OFFLINE) {
    startFFMPEG()
  } else {
    var privacys = {
      public: "{'value':'EVERYONE'}",
      friends: "{'value':'ALL_FRIENDS'}",
      friends_of_friends: "{'value':'FRIENDS_OF_FRIENDS'}",
      custom: "{'value':'CUSTOM', 'allow':'3205817'}",
      private: null,
    }
    console.log("------")
    console.log(privacys[FB_PRIVACY])
    console.log("------")
    FB.startLiveVideo({
      accessToken: FB_ACCESS_TOKEN,
      title: randomWord(),
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
  setTimeout(() => {
    if (FB.postId) {
      FB.endLiveVideo({
        postId: FB.postId,
        accessToken: FB_ACCESS_TOKEN,
      }).then(r => {
        process.exit()
      })
    } else {
      process.exit()
    }
  }, 15 * 60 * 1000)
}

if (OFFLINE) {
  start()
} else {
  setTimeout(() => {}, 15000)
  start()
}

console.log(`PRESS <ESCAPE> TO FINISH`)

//initWebgl()

//startStream(Object.assign({}, ffmpegOptions, { w: W, h: H }))
