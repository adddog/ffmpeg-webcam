#!/bin/bash
#

while getopts ":a:x:q:w:e:" o; do
    case "${o}" in
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

echo $EXT
echo $DURMIN
echo $DURMAX
echo $OUTFILE
echo $PWD

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

find "$PWD" -name "*.$EXT" -print0 | while read -d $'\0' file
do
    let START=0
    echo Processing $file
    filename=$(basename "$file")
    outFolder="_out/$filename-chop/"
    mkdir $outFolder
    for COUNT in {1..40}
    do
        outFile="${outFolder}${COUNT}-$filename"
        echo $outFile
        dur=$(( ( RANDOM % $DURMAX-$DURMIN )  + $DURMIN ))
        echo $dur
        ffmpeg -i "$file" -ss $START -t $dur -c:v copy -c:a copy -y -an "$outFile" < /dev/null
        SIZE=exec wc -c "$outFile" | awk '{print $1}' | bc
        echo $SIZE
        minimumsize=20000
        actualsize=$(wc -c <"$outFile")
        if [ $actualsize -ge $minimumsize ]; then
            echo size is over $minimumsize bytes
            outFiles+=("$outFile")
            shuffle "${outFiles}"
            echo ---------------------
            echo ${#outFiles[@]}
            echo ---------------------
            echo file \'"$outFile"\' >> tmp.txt
        else
            echo size is under $minimumsize bytes
            rm "$outFile"
        fi
        let START=$START+$dur
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

ffmpeg -safe 0 -f concat -i tmp.txt -f mp4 -c:v copy -an -y $OUTFILE.mp4
rm tmp.txt
rm -rf _out

IFS=$SAVEIFS