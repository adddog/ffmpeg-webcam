const headlessContext = require("gl")
const regl = require("regl")

const VERTEX_BUFFER = [[0, 0], [0, 1], [1, 0], [1, 1]]


module.exports = (config = {}) => {
  if (!config.width || !config.height) {
    throw new Error(`No width and height specified`)
  }

  const gl = regl({
    gl: headlessContext(config.width, config.height, {
      preserveDrawingBuffer: true,
    }),
  })
  const textures = {}

  const updateTextures = assets => {
    let draw = true
    for (let name in assets) {
      const val = assets[name]
      if (textures[name]) {
        textures[name]({
          format: val.format,
          width: val.width,
          type: "uint8",
          mag: "linear",
          min: "linear",
          wrapS: "clamp",
          wrapT: "clamp",
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

  const drawSingle = props => {
    gl.clear({
      color: [0, 0, 0, 1],
      depth: 1,
      stencil: 0,
    })

    return gl({
      vert: `
          precision lowp float;
          attribute vec2 position;
          varying vec2 texCoord;

          void main() {
            texCoord = position;
            gl_Position = vec4((position * 2.0 - 1.0) * vec2(1,1), 0.0, 1.0);
          }
          `,

      frag: `
          precision lowp float;
          uniform sampler2D tex0;
          varying vec2 texCoord;

          void main() {
            gl_FragColor = vec4(texture2D(tex0, texCoord).rgb,1);
          }

          `,

      uniforms: {
        tex0: gl.prop("tex0"),
      },
      attributes: {
        position: VERTEX_BUFFER,
      },
      primitive: "triangle strip",
      count: 4,
    })(props)
  }

  const mergeStreams = props => {
    gl.clear({
      color: [0, 0, 0, 1],
      depth: 1,
      stencil: 0,
    })

    return gl({
      vert: `
          precision lowp float;
          attribute vec2 position;
          varying vec2 texCoord;

          void main() {
            texCoord = position;
            gl_Position = vec4((position * 2.0 - 1.0) * vec2(1,1), 0.0, 1.0);
          }
          `,

      frag: `
          precision lowp float;
          uniform sampler2D tex0;
          uniform sampler2D tex1;
          uniform float slope;
          uniform float tolerance;
          uniform float keyIndex;

          uniform vec4 uSaturations;

          uniform vec3 keyColor;

          varying vec2 texCoord;

          vec3 changeSaturation(vec3 color, float saturation) {
            float luma = dot(vec3(0.2125, 0.7154, 0.0721) * color, vec3(1.));
            return mix(vec3(luma), color, saturation);
           }

          float chromaKeyAlphaTwoFloat(vec3 color, vec3 keyColor, float tolerance, float slope)
          {
            float d = abs(length(abs(keyColor - color)));
            float edge0 = tolerance * (1.0 - slope);
            float alpha = smoothstep(edge0, tolerance, d);
            return 1. - alpha;
          }

          void main() {

            vec3 c0 = changeSaturation(texture2D(tex0, texCoord).rgb, uSaturations.x);
            vec3 c1 = changeSaturation(texture2D(tex1, texCoord).rgb, uSaturations.y);

            vec3 knockoutC = mix(c0,c1, step(0.5, keyIndex));

            float ff = chromaKeyAlphaTwoFloat(knockoutC, keyColor, 1. - tolerance, slope);

            gl_FragColor = vec4(mix(c0, c1, ff),1);

            // gl_FragColor = vec4(
            //   color,
            //   1.0
            //   );
          }

          `,

      uniforms: {
        tex0: gl.prop("tex0"),
        tex1: gl.prop("tex1"),
        slope: gl.prop("slope"),
        keyColor: gl.prop("keyColor"),
        keyIndex: gl.prop("keyIndex"),
        tolerance: gl.prop("tolerance"),
        uSaturations: gl.prop("uSaturations"),
      },
      attributes: {
        position: VERTEX_BUFFER,
      },
      primitive: "triangle strip",
      count: 4,
    })(props)
  }

  let _tick = 0
  const convertMPEG = props => {
    if (updateTextures(props)) {
      gl.clear({
        color: [0, 0, 0, 1],
        depth: 1,
        stencil: 0,
      })

      return gl({
        vert: `
          precision lowp float;
          attribute vec2 position;
          varying vec2 texCoord;

          void main() {
            texCoord = position;
            gl_Position = vec4((position * 2.0 - 1.0) * vec2(1,1), 0.0, 1.0);
          }
          `,

        frag: `
          precision lowp float;
          uniform sampler2D YTexture;
          uniform sampler2D CBTexture;
          uniform sampler2D CRTexture;
          uniform float tick;
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
          position: VERTEX_BUFFER,
        },
        primitive: "triangle strip",
        count: 4,
      })(textures)
    }
  }

  return {
    read: (width, height) =>
      gl.read(new Uint8Array(width * height * 4)),
    regl: gl,
    convertMPEG: convertMPEG,
    drawSingle: drawSingle,
    mergeStreams: mergeStreams,
  }
}
