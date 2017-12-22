const Colors = require("colors")
const path = require("path")
const fluentFF = require("fluent-ffmpeg")
const spawn = require("child_process").spawnSync
const fs = require("fs")
const readDir = require("readdir")

module.exports = (videoTexture, config = {}) => {
  const PIX_SIZE = 4
  let WIDTH = 480
  let HEIGHT = 360
  let SIZE = WIDTH * HEIGHT * PIX_SIZE

  const MIN_TIME = 30
  const MAX_TIME = 120
  const FORCE_WIDTH = config.width || WIDTH
  const FORCE_HEIGHT = config.height || HEIGHT

  const filesArray = readDir.readSync(
    config.dir || __dirname,
    config.formats || ["**.mp4"],
    readDir.ABSOLUTE_PATHS
  )
  console.log(filesArray)
  let _fileIndex = 0

  const toArrayBuffer = require("to-array-buffer")
  const tou8 = require("buffer-to-uint8array")
  const Writable = require("stream").Writable,
    util = require("util")

  const WriteStream = function() {
    Writable.call(this, "binary")
  }
  util.inherits(WriteStream, Writable)

  let ffmpegCommand
  let _length = 0
  const _frameBuffers = []

  function updateDimensions({ width, height }) {
    WIDTH =  width
    HEIGHT =  height
    SIZE = WIDTH * HEIGHT * PIX_SIZE

    console.log(Colors.yellow(`WIDTH ${WIDTH}`));
    console.log(Colors.yellow(`HEIGHT ${HEIGHT}`));
  }

  WriteStream.prototype._write = function(chunk, encoding, callback) {
    _length += chunk.length
    if (_length % SIZE === 0) {
      videoTexture({
        format: "rgba",
        width: WIDTH,
        height: HEIGHT,
        type: "uint8",
        mag: "nearest",
        min: "nearest",
        wrapS: "clamp",
        wrapT: "clamp",
        data: tou8(Buffer.concat(_frameBuffers, SIZE)),
      })
      _length = 0
      _frameBuffers.length = 0
    } else {
      _frameBuffers.push(chunk)
    }
    callback()
  }

  const getVideoData = videoPath => {
    const child = spawn(`ffprobe`, [
      `-print_format`,
      `json`,
      `-show_format`,
      `-show_streams`,
      `-count_frames`,
      `${videoPath}`,
    ])
    const stdout = child.stdout.toString("utf-8")
    const json = JSON.parse(stdout).streams
    if (!json) return {}
    return {
      duration: Math.round(eval(json[0].duration)),
      width: Math.round(eval(json[0].width)),
      height: Math.round(eval(json[0].height)),
    }
  }

  function _startTimer() {
    const _playDuration =
      Math.random() * (MAX_TIME - MIN_TIME) * 1000 + MIN_TIME * 1000
    let _to = setTimeout(() => {
      _playNextVideo()
    }, _playDuration)
    console.log(Colors.green(`_playDuration ${_playDuration}`))
    return {
      playDuration: _playDuration,
      timeout: _to,
    }
  }

  function _playNextVideo() {
    if (ffmpegCommand && ffmpegCommand.kill) {
      ffmpegCommand.kill()
    }
    _fileIndex = (_fileIndex + 1) % filesArray.length
    play(filesArray[_fileIndex])
  }

  function play(src) {
    var ostream = new WriteStream()
    const data = getVideoData(src)
    console.log(data)
    updateDimensions(data)
    const {playDuration, timeout} = _startTimer()
    const _startTime = Math.max(
      Math.round(
        Math.random() * (data.duration - playDuration / 1000)
      ),
      0
    )
    console.log(Colors.green(`_startTime ${_startTime}`))
    const command = fluentFF(`${src}`)
      .inputOptions("-ss", _startTime)
      .native()
      .format("image2pipe")
      .videoCodec("rawvideo")
      //.size(`${WIDTH}:`) // HACK
      .outputOptions("-y", "-pix_fmt", "rgba", "-an", "-safe", "0")
      .on("start", function(err) {
        console.log(err)
      })
      .on("error", function(err) {
        console.log("An error occurred: " + err.message)
      })
      .on("end", function() {
        ostream = null
        console.log("Processing finished !")
        clearTimeout(timeout)
        _playNextVideo()
      })
      .pipe(ostream, { end: true })

    return command
  }

  ffmpegCommand = play(filesArray[_fileIndex])
}
