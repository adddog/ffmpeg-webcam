const WebcamWebsocket = require('./index')
const WEBCAM_IP  = "10.0.0.128"
const STREAM_IP  = "10.0.0.214"
const web = WebcamWebsocket({ip:WEBCAM_IP})
const ff = web.stream({
  ip:STREAM_IP,
  port:"1337"
})