const raf = require("raf")
var toBuffer = require("typedarray-to-buffer")
const ffmpeg = require("./lib/ffmpeg")
var now = require("performance-now")
const W = 352
const H = 288
var GL = require("gl")(W, H)
const WebcamWebsocket = require("./index")
const WEBCAM_IP = "10.0.1.7"
const WEBCAM_IP_2 = "10.0.1.9"
const STREAM_IP = "10.0.1.8"
const web = WebcamWebsocket()

const gl = GL
let FFMPEG
function startStream(options) {
  let maxrate = options.maxrate || 400
  FFMPEG = ffmpeg({
    format: "mpegts",
    w: options.w,
    h: options.h,
    output: `udp://${options.ip}:${options.port}`,
    options: [
      ` -preset ultrafast -tune zerolatency  -b:v ${maxrate /
        2}k -maxrate ${maxrate}k -bufsize ${maxrate}k  `,
    ],
  })
}

const ff = web.connect(GL, WEBCAM_IP, {
  ip: STREAM_IP,
  port: "1337",
})

const ff2 = web.connect(GL, WEBCAM_IP_2, {
  ip: STREAM_IP,
  port: "1337",
})

const SHADER_FRAGMENT_YCBCRTORGBA = [
    "precision lowp float;",
    "uniform sampler2D tex0;",
    "uniform sampler2D tex1;",
    "varying vec2 texCoord;",

    "void main() {",
    "vec3 cr0 = texture2D(tex0, texCoord).rgb;",
    "vec3 cr1 = texture2D(tex1, texCoord).rgb;",
    "vec3 c = mix(cr0,cr1,0.5);",

    "gl_FragColor = vec4(cr1,1);",

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
let _texture1, _texture2, program

const createTexture = (index, name) => {
  var gl = GL
  var texture = gl.createTexture()

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(gl.getUniformLocation(program, name), index)

  return texture
}


const renderWebgl = (tex0B, tex1B) => {
  var gl = GL

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, _texture1)

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    W,
    H,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    tex0B
  )

  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, _texture2)
  gl.texImage2D(
    gl.TEXTURE_2D,
    1,
    gl.RGBA,
    W,
    H,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    tex1B
  )

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

const compileShader = (type, source) => {
  var gl = GL
  var shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader))
  }

  return shader
}

const initWebgl = () => {
  // attempt to get a webgl context
  var gl = GL
  // init buffers
  var buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW
  )

  // The main YCbCrToRGBA Shader
  program = gl.createProgram()
  gl.attachShader(
    program,
    compileShader(gl.VERTEX_SHADER, SHADER_VERTEX_IDENTITY)
  )
  gl.attachShader(
    program,
    compileShader(gl.FRAGMENT_SHADER, SHADER_FRAGMENT_YCBCRTORGBA)
  )
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program))
  }

  gl.useProgram(program)

  // setup textures
  _texture1 = createTexture(0, "tex0")
  _texture2 = createTexture(1, "tex1")

  var vertexAttr = gl.getAttribLocation(program, "vertex")
  gl.enableVertexAttribArray(vertexAttr)
  gl.vertexAttribPointer(vertexAttr, 2, gl.FLOAT, false, 0, 0)
}

var _t = now().toFixed(3)
const fps = 2000
var handle = raf(function tick() {
  var start = now().toFixed(3)

  if (start - _t >= 80) {
    if (ff.player.outBuffer && ff2.player.outBuffer) {
      //console.log(ff2.player.outBuffer.buffer);
      renderWebgl(ff.player.outBuffer, ff2.player.outBuffer)
      var pixels = new Uint8Array(W * H * 4)
      GL.readPixels(0, 0, W, H, GL.RGBA, GL.UNSIGNED_BYTE, pixels)
      FFMPEG.frame(toBuffer(pixels))
      //FFMPEG.frame(toBuffer(ff2.player.outBuffer))
    }
    _t = start
  }
  raf(tick)
})

startStream(
  Object.assign(
    {},
    {
      ip: STREAM_IP,
      port: "1337",
    },
    { w: W, h: H }
  )
)

initWebgl()

//startStream(Object.assign({}, ffmpegOptions, { w: W, h: H }))
