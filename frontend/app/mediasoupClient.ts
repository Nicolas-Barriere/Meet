import axios from 'axios';

export async function leaveRoom(roomId: string, userId: string) {
  const res = await axios.post(`${API_URL}/leave`, { roomId, userId });
  return res.data;
}

export async function getProducers(roomId: string, userId: string) {
  const res = await axios.get(`${API_URL}/producers`, { params: { roomId, userId } });
  return res.data as Array<{ userId: string; producerId: string }>;
}

const API_URL = process.env.NEXT_PUBLIC_MEDIASOUP_API || 'http://localhost:3001';

export async function getRtpCapabilities() {
  const res = await axios.get(`${API_URL}/rtpCapabilities`);
  return res.data;
}


export async function createTransport(roomId: string, userId: string) {
  const res = await axios.post(`${API_URL}/createTransport`, { roomId, userId });
  return res.data;
}


export async function connectTransport(roomId: string, userId: string, dtlsParameters: any) {
  const res = await axios.post(`${API_URL}/connectTransport`, { roomId, userId, dtlsParameters });
  return res.data;
}


export async function produce(roomId: string, userId: string, transportId: string, kind: string, rtpParameters: any) {
  const res = await axios.post(`${API_URL}/produce`, { roomId, userId, transportId, kind, rtpParameters });
  return res.data;
}


export async function consume(roomId: string, userId: string, producerId: string, rtpCapabilities: any) {
  const res = await axios.post(`${API_URL}/consume`, { roomId, userId, producerId, rtpCapabilities });
  return res.data;
}
