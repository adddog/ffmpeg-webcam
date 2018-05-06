var spawn = require("child_process").spawn;
var exec = require("child_process").exec;

module.exports = createMovieRecorderStream;

function createMovieRecorderStream(options_) {
  var options = options_ || {
    w: 640,
    h: 480,
  };

  var ended = false;
  var ffmpegPath = options.ffmpeg || "ffmpeg";
  var fps = options.fps || 30;

  console.log(options);

  var args = [
    ...(options.input || []),
    //"-y",
    "-f",
    "image2pipe",
    "-framerate",
    "4",
    //"-vcodec",
    //`mjpeg`,
    // we use jpeg here because the most common version of ffmpeg (the one
    // that ships with homebrew) is broken and crashes when you feed it PNG data
    //  https://trac.ffmpeg.org/ticket/1272
    //"-vcodec",
    //"mjpeg",
    "-i",
    "-",
    //"-vsync",
    //"0",
    "-r",
    "8",
  ];

  var outFile = options.output;

  /*if ("format" in options) {
    args.push("-f", options.format)
  } else if (!outFile) {
  }*/

  args.push(...options.options);

  if (outFile) {
    args.push(outFile);
  } else {
    args.push("-");
  }

  if (options.ffplay) {
    args.push(options.ffplay);
  }
  console.log("Command:");
  console.log(args);
  console.log(`${ffmpegPath} ${args.join(" ")}`);
  /*var ffmpeg = spawn(ffmpegPath, args, {
    encoding: "buffer",
  });*/
  var ffmpeg = exec(`${ffmpegPath} ${args.join(" ")}`)

  function appendFrame(jpeg) {
    if (!ended) {
	console.log(jpeg.length);
      ffmpeg.stdin.write(jpeg);
    }
  }

  function endMovie() {
    ended = true;
    ffmpeg.stdin.end();
  }

  var result = {
    frame: appendFrame,
    end: endMovie,
    log: ffmpeg.stderr,
  };

  if (!outFile) {
    result.stream = ffmpeg.stdout;
  }

  return result;
}
