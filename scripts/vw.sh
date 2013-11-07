#!/bin/bash
index=1
vwarepath=$1
for voice in "Large Male" "Giant Male" "Male" "Female" "Child" "Old Woman" "Robotoid" "Martian" "Munchkin" "Colossus" "MellowFemale" "MellowMale" "CrispMale" "TheFly" "FastFred" "Troll" "Nerd" "MilkToast" "Tipsy" "Choirboy"
do
    echo "This is voice ${index}, ${voice}"
    $vwarepath -o eid=6 -o vid=${index}  \""This is voice ${index}, ${voice} "\"
    ((index++))
done
