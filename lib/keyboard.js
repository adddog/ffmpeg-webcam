const readline = require("readline")
readline.emitKeypressEvents(process.stdin)
process.stdin.setRawMode(true)

module.exports = GL_UNIFORMS => {
  process.stdin.on("keypress", (str, key) => {
    console.log(key.name)
    switch (key.name) {
      case "q":
        GL_UNIFORMS.keyTolerance = Math.min(
          GL_UNIFORMS.keyTolerance + 0.05,
          1
        )
        break
      case "a":
        GL_UNIFORMS.keyTolerance = Math.max(
          GL_UNIFORMS.keyTolerance - 0.05,
          0
        )
        break
      case "w":
        GL_UNIFORMS.keySlope = Math.min(
          GL_UNIFORMS.keySlope + 0.05,
          1
        )
        break
      case "s":
        GL_UNIFORMS.keySlope = Math.max(
          GL_UNIFORMS.keySlope - 0.05,
          0
        )
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
        GL_UNIFORMS.uSaturations[
          GL_UNIFORMS.selectionIndex
        ] = Math.min(
          GL_UNIFORMS.uSaturations[GL_UNIFORMS.selectionIndex] + 0.05,
          4
        )
        break
      case "h":
        GL_UNIFORMS.uSaturations[
          GL_UNIFORMS.selectionIndex
        ] = Math.max(
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
        GL_UNIFORMS.trailAmount = Math.min(
          GL_UNIFORMS.trailAmount + 0.05,
          1
        )
        break
      case "l":
        GL_UNIFORMS.trailAmount = Math.max(
          GL_UNIFORMS.trailAmount - 0.05,
          0
        )
        break

      case "z":
        GL_UNIFORMS.overlayKeyTolerance = Math.min(
          GL_UNIFORMS.overlayKeyTolerance + 0.05,
          1
        )
        break
      case "x":
        GL_UNIFORMS.overlayKeyTolerance = Math.max(
          GL_UNIFORMS.overlayKeyTolerance - 0.05,
          0
        )
        break
      case "c":
        GL_UNIFORMS.overlayKeySlope = Math.min(
          GL_UNIFORMS.overlayKeySlope + 0.05,
          1
        )
        break
      case "v":
        GL_UNIFORMS.overlayKeySlope = Math.max(
          GL_UNIFORMS.overlayKeySlope - 0.05,
          0
        )
        break

      case "b":
        GL_UNIFORMS.overlayKeyColor = GL_UNIFORMS.overlayKeyColor.map(
          c => Math.min(c + 0.05, 1)
        )
        break
      case "n":
        GL_UNIFORMS.overlayKeyColor = GL_UNIFORMS.overlayKeyColor.map(
          c => Math.max(c - 0.05, 0)
        )
        break

      case "space":
        GL_UNIFORMS.selectionIndex =
          (GL_UNIFORMS.selectionIndex + 1) % WEBCAM_IPS.length
        break

      case "escape":
        FFMPEG.end()
        FB.endLiveVideo({
          postId: FB.postId,
          accessToken: FB_ACCESS_TOKEN,
        })
        break
    }

    console.log("----Keys ----")
    console.log(`q - (a) is keyTolerance`)
    console.log(`w - (s) is keySlope`)
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
}
