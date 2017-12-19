const raf = require("raf")
var toBuffer = require("typedarray-to-buffer")
const ffmpeg = require("./lib/ffmpeg")
const FB = require("./lib/fb")
const GL = require("./lib/gl")
const BITRATE_A = 128
const BITRATE_V = 600
const FPS = 30
const WIDTH = 640
const HEIGHT = 480
/*const WIDTH = 352
const HEIGHT = 288*/
var now = require("performance-now")
const WebcamWebsocket = require("./index")
const WEBCAM_IPS = ["10.0.1.9"]
const WEBCAM_IP = "10.0.1.7"
const WEBCAM_IP_2 = "10.0.1.9"
const STREAM_IP = "10.0.1.8"
const web = WebcamWebsocket()

let FFMPEG
function startStream(options) {
  let maxrate = options.maxrate || 600
  FFMPEG = ffmpeg({
    ...options,
    w: options.w,
    h: options.h,
    output: options.output || `udp://${options.ip}:${options.port}`,
    options: [`${options.options || ""} `],

    /*

    */
  })
}

/*const ff2 = web.connect(GL, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})*/

const gl = GL({
  width: WIDTH,
  height: HEIGHT,
})

const connections = WEBCAM_IPS.map(ip =>
  web.connect(gl, ip, {
    ip: STREAM_IP,
    port: "1337",
  })
)

var _t = now().toFixed(3)
var handle = raf(function tick() {
  var start = now().toFixed(3)

  if (start - _t >= 25 && FFMPEG) {
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

function start() {
  var privacys = {
    public: "{'value':'EVERYONE'}",
    friends: "{'value':'ALL_FRIENDS'}",
    friends_of_friends: "{'value':'FRIENDS_OF_FRIENDS'}",
  }
  FB.startLiveVideo({
    accessToken:
      "EAAXiyxq1MwkBAOg8Qi5h17SIPtgkG0dfiFxn0u5kjTqC2YVNtZC9Cnd8lVWsmIZB3P4xmccCPpZB9XhKe1MC7yOTXmhL96xkgkB4GAZBiwiQkR4FNbVkKbZBydJ2zdSYVUFOQhsy6FtNh66HYTKz1ys74Oa4vPSEZD",
    title: "Live Video",
    /*privacy:
      privacys["public"] ||
      "{'value':'CUSTOM',allow:'100009508046151,1751806573'}",*/
  })
    .then(liveVideo => {
      console.log(liveVideo)

      var rtmpUrl = liveVideo.stream_url
      postId = liveVideo.id

      console.log("postId", postId)

      startStream(
        Object.assign(
          {},
          {
            ip: STREAM_IP,
            port: "1337",
            format: "flv",
            //input: [],
            //input: ["-f", "lavfi", "-i", "anullsrc"],
            input: ["-y", "-f", "avfoundation", "-i", ":2"],
            //input: ["-f", "alsa", "-ac", "1", "-ar", "44100" ,"-i", "hw:3"],
            //input: ["-i", "hw:1,0","-f alsa", "-ac", "2",],
            options:
              `-b:a ${BITRATE_A}k -c:v libx264 -profile:v baseline -pix_fmt yuv420p -g ${FPS * 2} -r ${FPS} -f flv -preset ultrafast -tune zerolatency  -b:v ${BITRATE_V}k -minrate ${BITRATE_V / 2}k  -maxrate ${BITRATE_V}k  -bufsize ${BITRATE_V}k`,
            //output: `"rtmp://a.rtmp.youtube.com/live2/f5v7-kfmq-27ce-9dft"`, //`"${rtmpUrl}"`,
            output:`"${rtmpUrl}"`
          },
          { w: WIDTH, h: HEIGHT }
        )
      )
    })
    .catch(error => {
      console.error(error.message, error.options)
    })
}

start()

//initWebgl()

//startStream(Object.assign({}, ffmpegOptions, { w: W, h: H }))
