Requiremnts: 

From Max

Working -STREAM RTP OUT
You must write the sdp to a file and read that with ffplay

https://cycling74.com/forums/broken-tutorial-53-jitter-networking-part-2-how-do-i-get-the-rtsp-address/

https://lists.ffmpeg.org/pipermail/ffmpeg-user/2016-February/030853.html
ffplay  -protocol_whitelist file,udp,rtp -i spd_file.spd


MAX will play ideas.


ffserver -f ffserver.conf

stream TCP has been seen to work. rtsp seems fastest.

http://peterelsea.com/Maxtuts_jitter/Jitter_with_net_cameras.pdf


Good settings for the room.
Video background keyed out around people
```
{ slope: 0.15000000000000002,
  tolerance: 0.4,
  keyIndex: 1,
  keyColor: [ 0.1499999999999997, 0.1499999999999997, 0.1499999999999997 ],
  uSaturations: [ 1.05, 1, 1, 1 ],
  selectionIndex: 0 }
```

python -m http.server 1111