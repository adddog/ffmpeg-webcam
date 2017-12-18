const headlessContext = require("gl")
const regl = require("regl")

const WIDTH = 640
const HEIGHT = 480

const VERTEX_BUFFER = [0, 0, 0, 1, 1, 0, 1, 1]

function headlessRegl(config) {
  const gl = headlessContext(WIDTH, HEIGHT, {
    preserveDrawingBuffer: true,
  })
  return Object.assign({ gl }, config)
}

module.exports = config => {
  const finalConfig = headlessRegl(config)

  const gl = regl(finalConfig)
  const textures = {}

  const updateTextures = assets => {
    let draw = true
    for (let name in assets) {
      const val = assets[name]
      if (textures[name]) {
        textures[name]({
          format: val.format,
          width: val.width,
          height: val.height,
          data: val.source,
        })
      } else {
        try {
          textures[name] = gl.texture({
            format: val.format || "rgba",
            width: val.width,
            height: val.height,
            type: "uint8",
            mag: "linear",
            min: "linear",
            wrapS: "clamp",
            wrapT: "clamp",
            data: val.source,
          })
        } catch (e) {
          draw = false
        }
      }
    }
    return draw
  }

  const convertMPEG = props => {
    if (updateTextures(props)) {
      gl({
        vert: `
          precision mediump float;
          attribute vec2 position;
          varying vec2 texCoord;

          void main() {
            texCoord = position;
            gl_Position = vec4((position * 2.0 - 1.0) * vec2(1,1), 0.0, 1.0);
          }
          `,

        frag: `
          precision mediump float;
          uniform sampler2D YTexture;
          uniform sampler2D CBTexture;
          uniform sampler2D CRTexture;
          varying vec2 texCoord;

          void main() {
            float y = texture2D(YTexture, texCoord).r;
            float cr = texture2D(CBTexture, texCoord).r - 0.5;
            float cb = texture2D(CRTexture, texCoord).r - 0.5;

            gl_FragColor = vec4(
              y + 1.4 * cr,
              y + -0.343 * cb - 0.711 * cr,
              y + 1.765 * cb,
              1.0
              );
          }

          `,

        uniforms: {
          // dynamic properties are invoked with the same `this` as the command
          YTexture: gl.prop("YTexture"),
          CBTexture: gl.prop("CBTexture"),
          CRTexture: gl.prop("CRTexture"),
        },

        attributes: {
          position:[0, 0, 0, 1, 1, 0, 1, 1],
          /*position: [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, -1],
            [1, 1],
            [-1, 1],
          ],*/
        },
        primitive: "triangle strip",
        count: 4,
      })(textures)
    }
  }

  return {
    read: () => gl.read(new Uint8Array(WIDTH * HEIGHT * 4)),
    regl: gl,
    convertMPEG: convertMPEG,
  }
}
