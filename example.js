const WebcamWebsocket = require("./index")
const WEBCAM_IP = "10.0.1.5"
const STREAM_IP = "10.0.1.8"
const web = WebcamWebsocket()
const ff = web.connect(WEBCAM_IP, {
  ip: STREAM_IP,
  port: "1337",
})
