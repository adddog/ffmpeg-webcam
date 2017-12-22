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
    let _tick = 0

  const updateTextures = assets => {
    let draw = true
    for (let name in assets) {
      const val = assets[name]
      if (textures[name]) {
        textures[name]({
          format: val.format,
          width: val.width,
          type: "uint8",
          mag: "nearest",
          min: "nearest",
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
            mag: "nearest",
            min: "nearest",
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
          uniform sampler2D overlay;
          varying vec2 texCoord;

          void main() {
            vec3 color = mix(texture2D(tex0, texCoord).rgb, texture2D(overlay, texCoord).rgb, 0.5);
            gl_FragColor = vec4(color,1);
          }

          `,

      uniforms: {
        tex0: gl.prop("tex0"),
        overlay: gl.prop("overlay"),
      },
      attributes: {
        position: VERTEX_BUFFER,
      },
      primitive: "triangle strip",
      count: 4,
    })(props)
  }

  const mergeStreams = props => {

    _tick++

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
          uniform sampler2D feedback;
          uniform sampler2D overlay;
          uniform float keySlope;
          uniform float keyTolerance;
          uniform float keyIndex;
          uniform float trailIndex;
          uniform float trailAmount;
          uniform float tick;

          uniform float overlayKeySlope;
          uniform float overlayKeyTolerance;

          uniform vec4 uSaturations;

          uniform vec3 keyColor;

          varying vec2 texCoord;

          float rand(float n){return fract(sin(n) * 43758.5453123);}

          // float noise(float p){
          //   float fl = floor(p);
          //   float fc = fract(p);
          //   return mix(rand(fl), rand(fl + 1.0), fc);
          // }

          // float noise(vec2 n) {
          //   const vec2 d = vec2(0.0, 1.0);
          //   vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
          //   return mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);
          // }

          vec3 changeSaturation(vec3 color, float saturation) {
            float luma = dot(vec3(0.2125, 0.7154, 0.0721) * color, vec3(1.));
            return mix(vec3(luma), color, saturation);
           }

          float chromaKeyAlphaTwoFloat(vec3 color, vec3 keyColor, float keyTolerance, float keySlope)
          {
            float d = abs(length(abs(keyColor - color)));
            float edge0 = keyTolerance * (1.0 - keySlope);
            float alpha = smoothstep(edge0, keyTolerance, d);
            return 1. - alpha;
          }

          void main() {
            float multi = sin(tick * 0.02) * 0.5 + 0.5; //0 - 1
            float multiSmall = multi * 0.03 - 0.015;
            vec2 wiggleCoord = texCoord;
            //wiggleCoord.x = wiggleCoord.x + mod((multi * 0.05 - 0.025), 0.01);
            //wiggleCoord.y = wiggleCoord.y + mod((multi * 0.05 - 0.025), 0.01);

            vec3 c0 = changeSaturation(texture2D(tex0, texCoord).rgb, (uSaturations.x * (0.4 * multi + 1.)));
            vec3 c1 = changeSaturation(texture2D(tex1, texCoord).rgb, (uSaturations.y * (0.4 * multi + 1.)));
            vec3 cFeedback = texture2D(feedback, texCoord).rgb;

            vec3 knockoutC = mix(c0,c1, step(0.5, keyIndex));
            vec3 knockoutCInv = mix(c0,c1, step(0.5, trailIndex));


            vec3 koColor = 1. - clamp(keyColor + multiSmall, 0., 1.);
            float ff = chromaKeyAlphaTwoFloat(knockoutC, koColor, 1. - clamp(keyTolerance + multiSmall, 0., 1.), clamp(keySlope, 0.001, 1.));

            vec3 color = mix(c0, c1, ff);

            /*
            Trails
            */
            float ff2 = chromaKeyAlphaTwoFloat(cFeedback, knockoutCInv, trailAmount , 0.02);
            gl_FragColor = vec4(
             mix( mix(knockoutCInv, cFeedback, ff2),color, ff),
            1);

            // gl_FragColor = vec4(
            //   mix(c0, c1, ff),
            // 1);

            // gl_FragColor = vec4(
            //   //mix(color,texture2D(feedback, wiggleCoord).rgb, ff2),
            //   mix(texture2D(feedback, wiggleCoord).rgb,color, ff),
            // 1);

            // gl_FragColor = vec4(
            //   vec3(wiggleCoord.x, wiggleCoord.y, 0.),
            //   1.0
            //   );
          }

          `,

      uniforms: {
        tick: _tick,
        tex0: gl.prop("tex0"),
        tex1: gl.prop("tex1"),
        feedback: gl.prop("feedback"),
        overlay: gl.prop("overlay"),
        keySlope: gl.prop("keySlope"),
        keyTolerance: gl.prop("keyTolerance"),
        overlayKeySlope: gl.prop("overlayKeySlope"),
        overlayKeyTolerance: gl.prop("overlayKeyTolerance"),
        keyColor: gl.prop("keyColor"),
        keyIndex: gl.prop("keyIndex"),
        trailIndex: gl.prop("trailIndex"),
        trailAmount: gl.prop("trailAmount"),
        uSaturations: gl.prop("uSaturations"),
      },
      attributes: {
        position: VERTEX_BUFFER,
      },
      primitive: "triangle strip",
      count: 4,
    })(props)
  }


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
