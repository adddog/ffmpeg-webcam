Requiremnts: 

From Max

Working -STREAM RTP OUT
You must write the sdp to a file and read that with ffplay

https://cycling74.com/forums/broken-tutorial-53-jitter-networking-part-2-how-do-i-get-the-rtsp-address/

https://lists.ffmpeg.org/pipermail/ffmpeg-user/2016-February/030853.html
ffplay  -protocol_whitelist file,udp,rtp -i spd_file.spd

ffmpeg -f avfoundation -list_devices true -i ""


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

AUDIO
https://fb360spatialworkstation.zendesk.com/hc/en-us/articles/115002372309-Using-an-ambisonic-microphone-with-your-Live-360-video-on-Facebook

https://stackoverflow.com/questions/25489628/streams-mixed-when-using-filter-complex-amerge-in-ffmpeg

Do not use above -a:b 128k

Route all channels from scarlette to SoundFlower 2ch

//720p
for i in *.mp4; do ffmpeg -i $i -c:v libx264 -an -vf scale=-1:288,crop=352:288:0:80,setsar=1 -f mp4 $i.mp4; done

for i in *.3gp; do ffmpeg -i $i -c:v libx264 -an -framerate 30 -r 30 -y -b:v 2000k  $i.mp4; done
./split-join.sh -x mp4 -q 20 -w 40 -e out

