const path = require('path')
const fs = require('fs')
const exec = require('child_process').exec
const Q = require('bluebird');
const readDir = require('readdir');

const extractPlaylistId = (url) => (url.split('list=')[1])

const Download = (() => {


  function playlist(p) {
    return new Q((yes, no) => {
      const saveDir = path.join(process.cwd(), process.env.VIDEO_DIR, extractPlaylistId(p))

      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir)
      } else {
        var filesArray = readDir.readSync(saveDir, ['**.mp4'], readDir.ABSOLUTE_PATHS);
        if(filesArray.length){
          return yes(filesArray)
        }
      }

      var cmd = `./binaries/youtube-dl ${p} --no-warnings  --yes-playlist -f 18/worstvideo -o '${saveDir}/%(id)s.%(ext)s'`
      console.log(cmd);
      exec(cmd,
        (e, stdout, stderr) => {
          if (e instanceof Error) {
            no(e)
          }
          var filesArray = readDir.readSync(saveDir, ['**.mp4'], readDir.ABSOLUTE_PATHS);

          yes(filesArray)
        });
    });
  }

  function video(videoId) {
    return new Q((yes, no) => {
      const saveDir = path.join(process.cwd(), process.env.VIDEO_DIR, videoId)

      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir)
      } else {
        var filesArray = readDir.readSync(saveDir, ['**.mp4'], readDir.ABSOLUTE_PATHS);
        if(filesArray.length){
          return yes(filesArray)
        }
      }

      var cmd = `./binaries/youtube-dl https://www.youtube.com/watch?v=${videoId} -f 18/worstvideo --no-warnings   -o '${saveDir}/%(id)s.%(ext)s'`
      console.log(cmd);
      exec(cmd,
        (e, stdout, stderr) => {
          if (e instanceof Error) {
            no(e)
          }

          var filesArray = readDir.readSync(saveDir, ['**.mp4'], readDir.ABSOLUTE_PATHS);
          yes(filesArray)
        });
    });
  }

  return {
    playlist: playlist,
    video: video
  }

})()

module.exports = Download
