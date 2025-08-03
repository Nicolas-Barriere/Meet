import express from 'express';
import http from 'http';
import cors from 'cors';
import mediasoup from 'mediasoup';

const { Worker, createWorker, types: mediasoupTypes } = mediasoup;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

let worker;
let router;
// Structure: rooms = Map<roomId, { transports: Map<userId, transport>, producers: Map<userId, Producer[]>, consumers: Map<userId, [consumer]> }>
const rooms = new Map();
// Produire un média (audio/video)
app.post('/produce', async (req, res) => {
  const { roomId, userId, transportId, kind, rtpParameters } = req.body;
  if (!rooms.has(roomId)) rooms.set(roomId, { transports: new Map(), producers: new Map(), consumers: new Map() });
  const room = rooms.get(roomId);
  const transport = room.transports.get(userId);
  if (!transport) {
    console.log(`[produce] No transport for userId=${userId} in roomId=${roomId}`);
    return res.status(404).json({ error: 'Transport not found' });
  }
  try {
    const producer = await transport.produce({ kind, rtpParameters });
    if (!room.producers.has(userId)) room.producers.set(userId, []);
    room.producers.get(userId).push(producer);
    console.log(`[produce] userId=${userId} in roomId=${roomId} produced kind=${kind}, producerId=${producer.id}`);
    res.json({ id: producer.id });
  } catch (err) {
    console.error(`[produce] ERROR userId=${userId} in roomId=${roomId}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Consommer un média (audio/video)
app.post('/consume', async (req, res) => {
  const { roomId, userId, producerId, rtpCapabilities } = req.body;
  if (!rooms.has(roomId)) {
    console.log(`[consume] Room not found: roomId=${roomId}`);
    return res.status(404).json({ error: 'Room not found' });
  }
  const room = rooms.get(roomId);
  if (!router) return res.status(500).json({ error: 'Router not ready' });
  const transport = room.transports.get(userId);
  if (!transport) {
    console.log(`[consume] No transport for userId=${userId} in roomId=${roomId}`);
    return res.status(404).json({ error: 'Transport not found' });
  }
  // Parcourt tous les tableaux de producers pour trouver le bon producerId
  let producer = null;
  for (const producersArr of room.producers.values()) {
    producer = producersArr.find(p => p.id === producerId);
    if (producer) break;
  }
  if (!producer) {
    console.log(`[consume] Producer not found: producerId=${producerId} in roomId=${roomId}`);
    return res.status(404).json({ error: 'Producer not found' });
  }
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    console.log(`[consume] Cannot consume: producerId=${producerId} userId=${userId}`);
    return res.status(400).json({ error: 'Cannot consume this producer' });
  }
  try {
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });
    if (!room.consumers.has(userId)) room.consumers.set(userId, []);
    room.consumers.get(userId).push(consumer);
    console.log(`[consume] userId=${userId} in roomId=${roomId} now consuming producerId=${producerId}`);
    res.json({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused
    });
  } catch (err) {
    console.error(`[consume] ERROR userId=${userId} in roomId=${roomId}:`, err);
    res.status(500).json({ error: err.message });
  }
});
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

async function startMediasoup() {
  worker = await createWorker();
  router = await worker.createRouter({ mediaCodecs });
  console.log('Mediasoup worker and router initialized');
}

startMediasoup();

// Route pour récupérer les RTP capabilities du serveur
app.get('/rtpCapabilities', (req, res) => {
  if (!router) return res.status(500).json({ error: 'Router not ready' });
  res.json(router.rtpCapabilities);
});

// Créer un WebRTC transport
app.post('/createTransport', async (req, res) => {
  const { roomId, userId } = req.body;
  if (!rooms.has(roomId)) rooms.set(roomId, { transports: new Map(), producers: new Map(), consumers: new Map() });
  const room = rooms.get(roomId);
  if (!router) return res.status(500).json({ error: 'Router not ready' });
  try {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1' }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    room.transports.set(userId, transport);
    console.log(`[createTransport] userId=${userId} in roomId=${roomId} created transportId=${transport.id}`);
    res.json({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  } catch (err) {
    console.error(`[createTransport] ERROR userId=${userId} in roomId=${roomId}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Connecter un transport (DTLS handshake)
app.post('/connectTransport', async (req, res) => {
  const { roomId, userId, dtlsParameters } = req.body;
  if (!rooms.has(roomId)) {
    console.log(`[connectTransport] Room not found: roomId=${roomId}`);
    return res.status(404).json({ error: 'Room not found' });
  }
  const room = rooms.get(roomId);
  const transport = room.transports.get(userId);
  if (!transport) {
    console.log(`[connectTransport] No transport for userId=${userId} in roomId=${roomId}`);
    return res.status(404).json({ error: 'Transport not found' });
  }
  try {
    await transport.connect({ dtlsParameters });
    console.log(`[connectTransport] userId=${userId} in roomId=${roomId} connected transportId=${transport.id}`);
    res.json({ connected: true });
  } catch (err) {
    console.error(`[connectTransport] ERROR userId=${userId} in roomId=${roomId}:`, err);
    res.status(500).json({ error: err.message });
  }
});
// Lister les producers d'une room (hors soi-même)
app.get('/producers', (req, res) => {
  const { roomId, userId } = req.query;
  if (!rooms.has(roomId)) {
    console.log(`[producers] Room not found: roomId=${roomId}`);
    return res.json([]);
  }
  const room = rooms.get(roomId);
  const list = [];
  for (const [uid, producersArr] of room.producers.entries()) {
    if (uid === userId) continue;
    for (const producer of producersArr) {
      list.push({ userId: uid, producerId: producer.id });
    }
  }
  console.log(`[producers] userId=${userId} in roomId=${roomId} sees producers:`, list);
  res.json(list);
});

// Supprimer tous les transports, producers et consumers d'un user dans une room
app.post('/leave', (req, res) => {
  const { roomId, userId } = req.body;
  if (!rooms.has(roomId)) {
    return res.status(200).json({ message: 'Room not found, nothing to clean.' });
  }
  const room = rooms.get(roomId);
  // Close and delete transport
  if (room.transports.has(userId)) {
    try { room.transports.get(userId).close(); } catch {}
    room.transports.delete(userId);
  }
// Close and delete all producers for this user
if (room.producers.has(userId)) {
  for (const producer of room.producers.get(userId)) {
    try { producer.close(); } catch {}
  }
  room.producers.delete(userId);
}
  // Close and delete all consumers for this user
  if (room.consumers.has(userId)) {
    for (const consumer of room.consumers.get(userId)) {
      try { consumer.close(); } catch {}
    }
    room.consumers.delete(userId);
  }
  res.json({ message: 'User cleaned up from room.' });
});

app.get('/', (req, res) => {
  res.send('Mediasoup server running');
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});