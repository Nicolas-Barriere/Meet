import express from 'express';
import http from 'http';
import cors from 'cors';
import mediasoup from 'mediasoup';
import { Server as SocketIOServer } from 'socket.io';

const { Worker, createWorker, types: mediasoupTypes } = mediasoup;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

let worker;
let router;
// Structure: rooms = Map<roomId, { transports: Map<userId, transport>, producers: Map<userId, Producer[]>, consumers: new Map<userId, [consumer]> }>
const rooms = new Map();

// Gestion des rooms côté socket.io
io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, userId }) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { transports: new Map(), producers: new Map(), consumers: new Map() });
    }
    socket.join(userId); // Permet d'envoyer des events ciblés à ce user
    socket.join(roomId); // Ajoute aussi le socket à la room globale pour broadcast
    socket.data.userId = userId;
    socket.data.roomId = roomId;
    const list = [];
    for (const [uid, producersArr] of rooms.get(roomId).producers.entries()) {
        if (uid === userId) continue;
        for (const p of producersArr) list.push({ producerId: p.id, userId: uid, kind: p.kind });
    }
    socket.emit('existing-producers', list);
  });

  socket.on('create-transport', async ({ roomId, userId }, callback) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { transports: new Map(), producers: new Map(), consumers: new Map() });
    }
    const room = rooms.get(roomId);
    if (!router) return callback({ error: 'Router not ready' });
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1' }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        appData: { userId } // Stocker le userId ici
      });
      // Utiliser transport.id comme clé
      room.transports.set(transport.id, transport);
      console.log(`[createTransport][ws] userId=${userId} in roomId=${roomId} created transportId=${transport.id}`);
      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (err) {
      console.error(`[createTransport][ws] ERROR userId=${userId} in roomId=${roomId}:`, err);
      callback({ error: err.message });
    }
  });

  socket.on('connect-transport', async ({ roomId, transportId, dtlsParameters }, callback) => {
    if (!rooms.has(roomId)) return callback({ error: 'Room not found' });
    const room = rooms.get(roomId);
    // Trouver le transport par son ID
    const transport = room.transports.get(transportId);
    if (!transport) return callback({ error: 'Transport not found' });
    try {
      await transport.connect({ dtlsParameters });
      console.log(`[connectTransport][ws] transportId=${transportId} connected in roomId=${roomId}`);
      callback({ connected: true });
    } catch (err) {
      console.error(`[connectTransport][ws] ERROR transportId=${transportId} in roomId=${roomId}:`, err);
      callback({ error: err.message });
    }
  });

  socket.on('produce', async ({ roomId, userId, transportId, kind, rtpParameters }, callback) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { transports: new Map(), producers: new Map(), consumers: new Map() });
    }
    const room = rooms.get(roomId);
    // Trouver le transport par son ID
    const transport = room.transports.get(transportId);
    if (!transport) return callback({ error: 'Transport not found' });
    try {
      const producer = await transport.produce({ kind, rtpParameters });
      if (!room.producers.has(userId)) room.producers.set(userId, []);
      room.producers.get(userId).push(producer);
      console.log(`[produce][ws] userId=${userId} in roomId=${roomId} produced kind=${kind} on transportId=${transportId}, producerId=${producer.id}`);
      // Informer les autres dans la room
      socket.to(roomId).emit('new-producer', {
        producerId: producer.id,
        userId,
        kind: producer.kind,
      });
      callback({ id: producer.id });
    } catch (err) {
      console.error(`[produce][ws] ERROR userId=${userId} in roomId=${roomId}:`, err);
      callback({ error: err.message });
    }
  });

  socket.on('consume', async ({ roomId, userId, transportId, producerId, rtpCapabilities }, callback) => {
    if (!rooms.has(roomId)) return callback({ error: 'Room not found' });
    const room = rooms.get(roomId);
    if (!router) return callback({ error: 'Router not ready' });
    // Trouver le transport par son ID (celui de réception)
    const transport = room.transports.get(transportId);
    if (!transport) return callback({ error: 'Transport not found' });
    
    let producerToConsume = null;
    for (const producersArr of room.producers.values()) {
        const p = producersArr.find(p => p.id === producerId);
        if (p) {
            producerToConsume = p;
            break;
        }
    }

    if (!producerToConsume) return callback({ error: 'Producer not found' });
    if (!router.canConsume({ producerId, rtpCapabilities })) return callback({ error: 'Cannot consume this producer' });

    try {
        const consumer = await transport.consume({
            producerId: producerToConsume.id,
            rtpCapabilities,
            paused: false
        });
        if (!room.consumers.has(userId)) room.consumers.set(userId, []);
        room.consumers.get(userId).push(consumer);
        console.log(`[consume][ws] userId=${userId} in roomId=${roomId} now consuming producerId=${producerId} on transportId=${transportId}`);
        callback({
            id: consumer.id,
            producerId: producerToConsume.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            type: consumer.type,
            producerPaused: consumer.producerPaused
        });
    } catch (err) {
        console.error(`[consume][ws] ERROR userId=${userId} in roomId=${roomId}:`, err);
        callback({ error: err.message });
    }
  });

  socket.on('get-rtp-capabilities', cb => {
    if (!router) return cb({ error: 'Router not ready' });
    cb(router.rtpCapabilities);
  });

  socket.on('disconnect', () => {
    const { userId, roomId } = socket.data;
    if (!userId || !roomId || !rooms.has(roomId)) {
      return;
    }

    console.log(`[disconnect] userId=${userId} from roomId=${roomId}`);
    const room = rooms.get(roomId);

    // Fermer et supprimer les producteurs de l'utilisateur
    const userProducers = room.producers.get(userId);
    if (userProducers) {
      userProducers.forEach(producer => {
        producer.close();
        // Notifier les autres que ce producteur est fermé
        socket.to(roomId).emit('producer-closed', { producerId: producer.id });
      });
      room.producers.delete(userId);
    }

    // Fermer et supprimer les transports de l'utilisateur
    room.transports.forEach((transport) => {
      if (transport.appData.userId === userId) {
        transport.close();
        room.transports.delete(transport.id);
      }
    });

    // Fermer et supprimer les consommateurs de l'utilisateur
    const userConsumers = room.consumers.get(userId);
    if (userConsumers) {
      userConsumers.forEach(consumer => consumer.close());
      room.consumers.delete(userId);
    }
  });
});

// Configuration des codecs média pour le router
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {}
  }
];

// Démarrage du worker et du router Mediasoup
async function startMediasoup() {
  worker = await createWorker();
  router = await worker.createRouter({ mediaCodecs });
  console.log('Mediasoup worker and router initialized');
}
startMediasoup();

// Route pour vérifier que le serveur tourne
app.get('/', (req, res) => res.send('Mediasoup server running'));

// Démarrage du serveur HTTP
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});