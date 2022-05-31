# Quick Gallery

This Node.js-based script:
* takes a directory on your disk
* finds all files that end in `*.JPG`
* generates thumbnails for the found pictures
* serves a password-protected gallery for browsing them

## Install and run
```
git clone https://github.com/rkaw92/node-quick-gallery.git
cd node-quick-gallery
npm ci
npm start
```

By default, the script will serve some sample images. You can verify it works by going to http://localhost:3000 .  
The default password is randomized - look at the console output to find it.

To point the script to a directory which contains your own photos for the gallery, use environment variables:
```
PHOTO_DIRECTORY=$HOME/Pictures/2022/Holiday npm start
```

To also set your own username/password, instead of generating a new password on each start:
```
export PHOTO_DIRECTORY=$HOME/Pictures/2022/Holiday
export LOGIN=robert
export PASSWORD=swordfish
npm start
```

## License
MIT (see file LICENSE).
