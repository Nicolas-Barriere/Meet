import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_MEDIASOUP_API || 'http://localhost:3001';

export async function getProducers(roomId: string, userId: string) {
  const res = await axios.get(`${API_URL}/producers`, { params: { roomId, userId } });
  return res.data as Array<{ userId: string; producerId: string }>;
}
