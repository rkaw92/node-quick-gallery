'use strict';

const fastify = require('fastify');
const util = require('util');
const glob = util.promisify(require('glob'));
const cliProgress = require('cli-progress');
const sharp = require('sharp');
const pLimit = require('p-limit');
const pov = require('point-of-view');
const basicAuth = require('@fastify/basic-auth');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const HTTP_PORT = parseInt(process.env.HTTP_PORT, 10) || 3000;
const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 200;
const VIEW_WIDTH = 1920;
const VIEW_HEIGHT = 1280;
const ASPECT_RATIO = (VIEW_HEIGHT / VIEW_WIDTH);
const CONCURRENCY = os.cpus().length;
const LOGIN = process.env.LOGIN || 'guest';
const makeRandomPassword = () => {
    const randomPassword = crypto.randomBytes(16).toString('hex');
    console.log('Login: %s, random password: %s', LOGIN, randomPassword);
    return randomPassword;
}
const PASSWORD = process.env.PASSWORD || makeRandomPassword();
const PHOTO_DIRECTORY = process.env.PHOTO_DIRECTORY || path.resolve(__dirname, 'samples');

function hashImage(imageBuffer) {
    const hasher = crypto.createHash('sha256');
    hasher.update(imageBuffer);
    return hasher.digest().toString('hex');
}

async function makeThumbnail(inputPath) {
    return await sharp(inputPath)
        .rotate()
        .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'contain' })
        .toBuffer();
}

function streamScaled(inputStream, width, height) {
    const resizer = sharp().resize(width, height, { fit: 'contain' });
    inputStream.pipe(resizer);
    return resizer;
}

(async function() {
    let photoPaths = await glob(`${PHOTO_DIRECTORY}/**/*.jpg`, { nocase: true });
    const photos = new Array(photoPaths.length);
    const thumbnailProgressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    thumbnailProgressBar.start(photoPaths.length, 0);
    const concurrencyLimiter = pLimit(CONCURRENCY);
    const allDone = [];
    for (const [ fileIndex, inputPath ] of photoPaths.entries()) {
        allDone.push(concurrencyLimiter(async function() {
            const thumbnail = await makeThumbnail(inputPath);
            const thumbnailEtag = hashImage(thumbnail);
            photos[fileIndex] = {
                path: inputPath,
                thumbnail: {
                    image: thumbnail,
                    width: THUMB_WIDTH,
                    height: THUMB_HEIGHT,
                    etag: thumbnailEtag
                }
            };
            thumbnailProgressBar.increment();
        }));
    }
    await Promise.all(allDone);
    thumbnailProgressBar.stop();

    const app = fastify();
    app.register(pov, {
        engine: {
            ejs: require("ejs")
        },
        root: path.resolve(__dirname, 'templates'),
        includeViewExtension: true
    });
    app.register(basicAuth, {
        authenticate: { realm: 'Galeria' },
        validate: function(username, password, req, reply, done) {
            // NOTE: This is vulnerable to timing attacks, but for this quick'n'dirty app, it will do.
            if (username === LOGIN && password === PASSWORD) {
                done();
            } else {
                done(new Error('Invalid username or password'));
            }
        }
    });
    app.after(function() {
        app.register(async function(instance, _options) {
            instance.addHook('onRequest', instance.basicAuth);
    
            instance.get('/', async function(req, reply) {
                reply.view('index', {
                    photos
                });
            });

            instance.get('/view/:photoNumber', async function(req, reply) {
                const photoNumber = Number(req.params.photoNumber);
                const requestedPhoto = photos[photoNumber];
                if (!requestedPhoto) {
                    return reply.status(404).send();
                }
                return reply.view('view', {
                    photoNumber,
                    previous: (photoNumber === 0) ? NaN : photoNumber - 1,
                    next: (photoNumber === photos.length-1) ? NaN : photoNumber + 1
                });
            });
    
            instance.get('/thumbs/:photoNumber', async function(req, reply) {
                const requestedPhoto = photos[Number(req.params.photoNumber)];
                if (!requestedPhoto) {
                    return reply.status(404).send();
                }
                if (req.headers['if-none-match'] && req.headers['if-none-match'] === `"${requestedPhoto.thumbnail.etag}"`) {
                    return reply.status(304).send();
                }
                reply.header('Content-Type', 'image/jpeg');
                reply.header('ETag', `"${requestedPhoto.thumbnail.etag}"`);
                return reply.send(requestedPhoto.thumbnail.image);
            });
    
            instance.get('/photos/:photoNumber', async function(req, reply) {
                const requestedPhoto = photos[Number(req.params.photoNumber)];
                if (!requestedPhoto) {
                    return reply.status(404).send();
                }
                reply.header('Content-Type', 'image/jpeg');
                let inputStream = fs.createReadStream(requestedPhoto.path);
                let outputStream = inputStream;
                if (req.query.width) {
                    outputStream = streamScaled(inputStream, Number(req.query.width), Math.round(Number(req.query.width) * ASPECT_RATIO));
                }
                return reply.send(outputStream);
            });
        });
    });
    await app.listen(HTTP_PORT, '0.0.0.0');
    console.log('Thumbnails loaded - server is listening on port %d', HTTP_PORT);
})();
