const fs = require("fs")
const readline = require("readline")
readline.emitKeypressEvents(process.stdin)
process.stdin.setRawMode(true)

module.exports = ({
  GL_UNIFORMS,
  WEBCAM_IPS,
  FFMPEG,
  FB_ACCESS_TOKEN,
  FB,
}) => {
  const saveSettings = () => {
    console.log(JSON.stringify(GL_UNIFORMS, null, 4));
    fs.writeFile(
      "settings.json",
      JSON.stringify(GL_UNIFORMS, null, 4),
      (err, res) => {}
    )
  }
  process.stdin.on("keypress", (str, key) => {
    console.log(key.name)
    switch (key.name) {
      case "q":
        GL_UNIFORMS.keyTolerance =
          (GL_UNIFORMS.keyTolerance + 0.025) % 1
        saveSettings()
        break
      case "w":
        GL_UNIFORMS.keySlope = (GL_UNIFORMS.keySlope + 0.025) % 1
        saveSettings()
        break
      case "e":
        GL_UNIFORMS.keyColor = GL_UNIFORMS.keyColor.map(
          c => (c + 0.01) % 1
        )
        saveSettings()
        break
      case "r":
        GL_UNIFORMS.uSaturations[
          GL_UNIFORMS.selectionIndex
        ] = GL_UNIFORMS.uSaturations[GL_UNIFORMS.selectionIndex] =
          (GL_UNIFORMS.uSaturations[GL_UNIFORMS.selectionIndex] +
            0.025) %
          4
        saveSettings()
        break
      case "t":
        GL_UNIFORMS.uBrightnesses[
          GL_UNIFORMS.selectionIndex
        ] = GL_UNIFORMS.uBrightnesses[GL_UNIFORMS.selectionIndex] =
          (GL_UNIFORMS.uBrightnesses[GL_UNIFORMS.selectionIndex] +
            0.015) %
          1
        saveSettings()
        break
      case "y":
        GL_UNIFORMS.uContrasts[
          GL_UNIFORMS.selectionIndex
        ] = GL_UNIFORMS.uContrasts[GL_UNIFORMS.selectionIndex] =
          (GL_UNIFORMS.uContrasts[GL_UNIFORMS.selectionIndex] +
            0.015) %
          2
        saveSettings()
        break

      //!!! invert webcam the key
      case "i":
        GL_UNIFORMS.keyIndex = GL_UNIFORMS.keyIndex === 0 ? 1 : 0
        saveSettings()
        break
      //!!! invert trail on webcam
      case "k":
        GL_UNIFORMS.trailIndex = GL_UNIFORMS.trailIndex === 0 ? 1 : 0
        saveSettings()
        break

      case "o":
        GL_UNIFORMS.trailAmount =
          (GL_UNIFORMS.trailAmount + 0.025) % 1
        saveSettings()
        break

      /*
  OVERLAY
        */

      case "a":
        GL_UNIFORMS.overlaySelectionIndex =
          GL_UNIFORMS.overlaySelectionIndex === 0 ? 1 : 0
        saveSettings()
        break

      case "b":
        GL_UNIFORMS.overlayTone[0] =
          (GL_UNIFORMS.overlayTone[0] + 0.01) % 1
        saveSettings()
        break
      case "n":
        GL_UNIFORMS.overlayTone[1] =
          (GL_UNIFORMS.overlayTone[1] + 0.01) % 1
        saveSettings()
        break

      case "z":
        GL_UNIFORMS.overlayKeyTolerance =
          (GL_UNIFORMS.overlayKeyTolerance + 0.025) % 1
        saveSettings()
        break
      case "x":
        GL_UNIFORMS.overlayKeySlope =
          (GL_UNIFORMS.overlayKeySlope + 0.025) % 1
        saveSettings()
        break
      case "c":
        GL_UNIFORMS.overlayKeyColor = GL_UNIFORMS.overlayKeyColor.map(
          c => (c + 0.01) % 1
        )
        saveSettings()
        break
      case "v":
        GL_UNIFORMS.overlayContrast =
          (GL_UNIFORMS.overlayContrast + 0.025) % 2
        saveSettings()
        break
      case "m":
        GL_UNIFORMS.overlaySaturation =
          (GL_UNIFORMS.overlaySaturation + 0.025) % 4
        saveSettings()
        break
      case "l":
        GL_UNIFORMS.overlayColorMix =
          (GL_UNIFORMS.overlayColorMix + 0.01) % 1
        saveSettings()
        break

      case "space":
        GL_UNIFORMS.selectionIndex =
          (GL_UNIFORMS.selectionIndex + 1) % WEBCAM_IPS.length
        saveSettings()
        break

      case "escape":
        FFMPEG.end()
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
        break
    }

    console.log("----Keys ----")
    console.log(`q - (a) is keyTolerance`)
    console.log(`w - (s) is keySlope`)
    console.log(`t - (g) is color`)
    console.log(`i is invert`)
    console.log("\n")
    console.log("GL_UNIFORMS-----")
    console.log(JSON.stringify(GL_UNIFORMS, null, 4))
    console.log("\n")

    // "Raw" mode so we must do our own kill switch
    if (key.sequence === "\u0003") {
      process.exit()
    }

    // User has triggered a keypress, now do whatever we want!
    // ...
  })
}
