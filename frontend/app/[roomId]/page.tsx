'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import * as mediasoupClient from 'mediasoup-client';
import { v4 as uuidv4 } from 'uuid';
import { io, Socket } from 'socket.io-client';

type RemoteStream = {
  producerId: string;
  userId: string;
  kind: string;
  stream: MediaStream;
};

export default function RoomPage() {
  const { roomId } = useParams();
  const [joined, setJoined] = useState(false);
  const [userId] = useState(() => uuidv4());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs to keep persistent objects
  const deviceRef = useRef<mediasoupClient.types.Device | null>(null);
  const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const producersRef = useRef<mediasoupClient.types.Producer[]>([]);
  const consumersRef = useRef<mediasoupClient.types.Consumer[]>([]);
  const consumedProducerIdsRef = useRef<Set<string>>(new Set());
  const socketRef = useRef<Socket | null>(null);

  // Helper to add/merge remote stream
  const addRemoteStream = (streamObj: RemoteStream) => {
    setRemoteStreams(prev => {
      const map = new Map(prev.map(s => [s.producerId, s]));
      map.set(streamObj.producerId, streamObj);
      return Array.from(map.values());
    });
  };

  useEffect(() => {
    if (!joined || !roomId) return;
    let isUnmounted = false;

    const init = async () => {
      try {
        // 1. socket.io (définit l'URL du serveur mediasoup)
        const socket = io(process.env.NEXT_PUBLIC_MEDIASOUP_WS_URL || 'http://localhost:3001');
        socketRef.current = socket;

        // On attend que la connexion soit établie avant de continuer.
        await new Promise<void>(resolve => socket.on('connect', () => resolve()));

        // 2. obtenir rtpCapabilities
        const rtpCapabilities: any = await new Promise((res, rej) => {
          socket.emit('get-rtp-capabilities', (payload: any) => {
            if (payload?.error) return rej(new Error(payload.error));
            res(payload);
          });
        });

        // 3. charger mediasoup device
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;

        // 4. créer sendTransport via socket
        const sendTransportData: any = await new Promise((res, rej) => {
          socket.emit('create-transport', { roomId, userId }, (d: any) => {
            if (d?.error) return rej(new Error(d.error));
            res(d);
          });
        });
        const sendTransport = device.createSendTransport(sendTransportData);
        sendTransportRef.current = sendTransport;

        // wire sendTransport events
        sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          socket.emit('connect-transport', { roomId, transportId: sendTransport.id, dtlsParameters }, (resp: any) => {
            if (resp?.error) return errback(new Error(resp.error));
            callback();
          });
        });
        sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          socket.emit('produce', { roomId, userId, transportId: sendTransport.id, kind, rtpParameters }, (resp: any) => {
            if (resp?.error) return errback(new Error(resp.error));
            callback({ id: resp.id });
          });
        });

        // 5. créer recvTransport
        const recvTransportData: any = await new Promise((res, rej) => {
          socket.emit('create-transport', { roomId, userId }, (d: any) => {
            if (d?.error) return rej(new Error(d.error));
            res(d);
          });
        });
        const recvTransport = device.createRecvTransport(recvTransportData);
        recvTransportRef.current = recvTransport;

        recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          socket.emit('connect-transport', { roomId, transportId: recvTransport.id, dtlsParameters }, (resp: any) => {
            if (resp?.error) return errback(new Error(resp.error));
            callback();
          });
        });

        // 6. getUserMedia et produire
        const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream;

        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];

        if (videoTrack) {
          const videoProducer = await sendTransport.produce({ track: videoTrack });
          producersRef.current.push(videoProducer);
        }
        if (audioTrack) {
          const audioProducer = await sendTransport.produce({ track: audioTrack });
          producersRef.current.push(audioProducer);
        }

        // Une fois que nous sommes prêts à produire, on rejoint la room
        socket.emit('join-room', { roomId, userId });

        // 7. gérer les producteurs déjà présents quand on arrive
        socket.on('existing-producers', async (list: Array<{ producerId: string; userId: string; kind: string }>) => {
          if (!recvTransportRef.current) return;
          for (const p of list) {
            if (consumedProducerIdsRef.current.has(p.producerId)) continue;
            try {
              const consumerData: any = await new Promise((res, rej) => {
                socket.emit('consume', { roomId, userId, transportId: recvTransportRef.current!.id, producerId: p.producerId, rtpCapabilities: device.rtpCapabilities }, (d: any) => {
                  if (d?.error) return rej(new Error(d.error));
                  res(d);
                });
              });
              const consumer = await recvTransportRef.current.consume({
                id: consumerData.id,
                producerId: consumerData.producerId,
                kind: consumerData.kind,
                rtpParameters: consumerData.rtpParameters,
              });
        // 1. getUserMedia local preview
        const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
              if (consumer.paused) await consumer.resume();
              consumersRef.current.push(consumer);
              consumedProducerIdsRef.current.add(consumerData.producerId);
              const remoteStream = new MediaStream([consumer.track]);
              addRemoteStream({ producerId: consumerData.producerId, userId: p.userId, kind: consumerData.kind, stream: remoteStream });
            } catch (e) {
              console.warn('Erreur existing-producer consume', e);
            }
          }
        });

        // 8. nouveau producer à la volée
        socket.on('new-producer', async ({ producerId, userId: remoteUserId, kind }: { producerId: string; userId: string; kind: string }) => {
          if (consumedProducerIdsRef.current.has(producerId) || !recvTransportRef.current) return;
          try {
            const consumerData: any = await new Promise((res, rej) => {
              socket.emit('consume', { roomId, userId, transportId: recvTransportRef.current!.id, producerId, rtpCapabilities: device.rtpCapabilities }, (d: any) => {
                if (d?.error) return rej(new Error(d.error));
                res(d);
              });
            });
            const consumer = await recvTransportRef.current.consume({
              id: consumerData.id,
              producerId: consumerData.producerId,
              kind: consumerData.kind,
              rtpParameters: consumerData.rtpParameters,
            });
            if (consumer.paused) await consumer.resume();
            consumersRef.current.push(consumer);
            consumedProducerIdsRef.current.add(producerId);
            const remoteStream = new MediaStream([consumer.track]);
            addRemoteStream({ producerId, userId: remoteUserId, kind: consumerData.kind, stream: remoteStream });
          } catch (e) {
            console.warn('Erreur new-producer consume', e);
          }
        });

        // 9. Gérer la fermeture d'un producteur
        socket.on('producer-closed', ({ producerId }: { producerId: string }) => {
          // Retirer le consommateur associé
          const consumerToClose = consumersRef.current.find(c => c.producerId === producerId);
          if (consumerToClose) {
            consumerToClose.close();
            consumersRef.current = consumersRef.current.filter(c => c.id !== consumerToClose.id);
            consumedProducerIdsRef.current.delete(producerId);
          }

          // Retirer le flux de l'UI
          setRemoteStreams(prev => prev.filter(s => s.producerId !== producerId));
        });

        // erreur socket
        socket.on('connect_error', (e) => setError(`Socket.IO erreur: ${e.message}`));
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Erreur d\'initialisation mediasoup');
      }
    };

    init();

    return () => {
      isUnmounted = true;
      // cleanup
      window.removeEventListener('beforeunload', () => {});
      // fermer producteurs / consumers / transports
      producersRef.current.forEach(p => p.close());
      consumersRef.current.forEach(c => c.close());
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      socketRef.current?.disconnect();
    };
  }, [joined, roomId, userId]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen">
      <div className="p-8 bg-white rounded shadow max-w-xl w-full">
        <h2 className="text-xl font-bold mb-4">Salle : {roomId}</h2>
        {!joined ? (
          <button onClick={() => setJoined(true)} className="px-4 py-2 bg-blue-600 text-white rounded">
            Rejoindre la visio
          </button>
        ) : (
          <div className="flex gap-6">
            <div>
              <h4>Votre caméra</h4>
              <video ref={localVideoRef} autoPlay muted playsInline className="w-64 h-48 bg-black" />
            </div>
            <div>
              <h4>Flux distants</h4>
              <div className="flex flex-wrap gap-4">
                {remoteStreams.map(s => (
                  <div key={s.producerId} className="flex flex-col items-center">
                    {s.kind === 'video' ? (
                      <video
                        autoPlay
                        playsInline
                        ref={(el) => {
                          if (el) el.srcObject = s.stream;
                        }}
                        className="w-48 h-36 bg-black"
                      />
                    ) : (
                      <audio autoPlay ref={(el) => { if (el) el.srcObject = s.stream; }} />
                    )}
                    <div className="text-xs mt-1">{s.userId} / {s.kind}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {error && <div className="text-red-600 mt-4">{error}</div>}
      </div>
    </main>
  );
}
