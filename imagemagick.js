const imagemagick = require("imagemagick-native")
var { PassThrough } = require("stream")
var spawn = require("child_process").spawn
const fs = require("fs")

const WIDTH = 352
const HEIGHT = 288
var rgba = new Uint8Array(WIDTH * HEIGHT * 4)
var i = WIDTH * HEIGHT * 4
while (i > 0) {
  rgba[i] = parseInt(Math.random() * 255, 10)
  i--
}

const convertFast = (buffer, args, callback) => {
  const stdout = []
  var magick = spawn("convert", args)

  magick.stdout.on("data", function(data) {
    stdout.push(data)
  })

  magick.on("close", function(code) {
    if(!code){
      callback(Buffer.concat(stdout))
    }
    stdout.length = 0
    magick.kill()
  })

  magick.stdin.write(buffer)
  magick.stdin.end()
}

/**~~~~**
 *    slow
 **~~~~* */
function convert(stdin, args, callback) {
  var stdout = []
  var stderr = []

  var magick = spawn("convert", args)

  var timeoutID = setTimeout(function() {
    p.kill("SIGKILL")
    stderr.push(new Buffer("SIGKILL"))
  }, 60000)

  magick.stdout.on("data", function(data) {
    stdout.push(data)
  })

  magick.stderr.on("data", function(data) {
    stderr.push(data)
  })

  magick.on("close", function(code) {
    clearTimeout(timeoutID)
    if (code || stderr.length) {
      return callback(stderr)
    }
    callback(Buffer.concat(stdout))
  })

  magick.stdin.write(stdin)
  magick.stdin.end()
}

convertFast(
  Buffer.from(rgba),
  ["-depth", "8", "-size", `${WIDTH}x${HEIGHT}`, "rgba:-", "JPEG:-"],
  buffer => {
    fs.writeFileSync("file.jpeg", buffer)
  }
)

/*var ffmpeg = spawn("convert", [
  "-depth",
  "8",
  "-size",
  `${WIDTH}x${HEIGHT}`,
  "rgba:-",
  "JPEG:-",
])

ffmpeg.stderr.on("data", function(data) {
  alert("stderr: " + data)
})

ffmpeg.on("exit", function(code) {
  if (code === 0) alert("done")
})

ffmpeg.stdout.on("data", data => {
  console.log("new data: ", data)
})

ffmpeg.stdin.write(Buffer.from(rgba))
ffmpeg.stdin.end()*/

//new PassThrough(Buffer.from(rgba)).pipe(ffmpeg.stdio[3])

//console.log(fs.readFileSync("file.rgba"));

//

/*imagemagick.convert(
  {
    srcData: Buffer.from(rgba),
    debug: true,
    width: WIDTH,
    height: HEIGHT,
    format: "JPEG",
  },
  function(err, buffer) {
    // check err, use buffer
    console.log(err)
    console.log(buffer)
  }
)
*/
