#!/bin/bash
#

while getopts "d:x:q:w:e:" o; do
    case "${o}" in
        d)
            d=${OPTARG}
            ;;
        x)
            x=${OPTARG}
            ;;
        q)
            q=${OPTARG}
            ;;
        w)
            w=${OPTARG}
            ;;
        e)
            e=${OPTARG}
            ;;
    esac
done
shift $((OPTIND-1))


EXT=${x}
DURMIN=${q}
DURMAX=${w}
OUTFILE=${e}
DIR=${d}

echo $EXT
echo $DURMIN
echo $DURMAX
echo $OUTFILE
echo $DIR

SAVEIFS=$IFS
IFS=$(echo -en "\n\b")
#FILES=$(find "$PWD" -name "*.$EXT" -print0 | while read -d $'\0' file)
#echo $FILES
outFiles=()

shuffle() {
   local_variable="${1}"
   echo ${#local_variable[@]}
   local i tmp size max rand

   # $RANDOM % (i+1) is biased because of the limited range of $RANDOM
   # Compensate by using a range which is a multiple of the outFiles size.
   size=${#local_variable[*]}
   max=$(( 32768 / size * size ))

   for ((i=size-1; i>0; i--)); do
      while (( (rand=$RANDOM) >= max )); do :; done
      rand=$(( rand % (i+1) ))
      tmp=${$local_variable[i]} $local_variable[i]=${$local_variable[rand]} $local_variable[rand]=$tmp
   done
}

rm -rf _out
mkdir _out
rm tmp.txt

find "$DIR" -name "*.$EXT" -print0 | while read -d $'\0' file
do
    let START=0
    echo Processing $file
    filename=$(basename "$file")
    outFolder="_out/$filename-chop/"
    mkdir $outFolder
    for COUNT in {1..30}
    do
        outFile="${outFolder}${COUNT}-$filename".ts
        echo $outFile
        dur=$(( ( RANDOM % $DURMAX-$DURMIN )  + $DURMIN ))
        end=$START+$dur
        echo $end
        #echo $dur
        #ffmpeg -i "$file" -ss $START -t $dur -c:v copy -an -reset_timestamps 1 -g 30 -avoid_negative_ts 1 -f mp4 -nostats -loglevel 0 -y -an "$outFile" < /dev/null
        ffmpeg -i "$file" -ss $START -t $dur -c:v libx264 -an -bsf:v h264_mp4toannexb -f mpegts  -nostats -loglevel 0 -y -an "$outFile" < /dev/null
        SIZE=exec wc -c "$outFile" | awk '{print $1}' | bc
        #echo $SIZE
        minimumsize=20000
        actualsize=$(wc -c <"$outFile")
        if [ $actualsize -ge $minimumsize ]; then
            echo $outFile size is over $minimumsize bytes
            outFiles+=($outFile)
            shuffle "${outFiles}"
        else
            echo size is under $minimumsize bytes
            rm "$outFile"
        fi
        let START=$START+$dur
    done
    for i in "${outFiles[@]}"
    do
      echo file \'"${outFiles[ $(( RANDOM % ${#outFiles[@]} )) ] }"\' >> tmp.txt
    done
done

# echo here
# echo ${#outFiles[@]}
# printf '%s\n' "${outFiles[@]}"
# echo ---------------------


# shuffle


# for j in "${outFiles[@]}"
# do
#       echo file \'"$j"\'
# done >tmp.txt

tmpo="${OUTFILE}-tmp"

echo $tmpo

ffmpeg -fflags +igndts  -safe 0 -f concat -nostats -loglevel 0 -i tmp.txt -f mp4 -c copy -bsf:a aac_adtstoasc -fflags +genpts -y $OUTFILE.mp4
#rm
rm -rf _out

IFS=$SAVEIFS