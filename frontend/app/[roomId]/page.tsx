'use client';
import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
const RoomJoinConfirmation = dynamic(() => import('../components/RoomJoinConfirmation'), { ssr: false });
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
  const [preJoinStream, setPreJoinStream] = useState<MediaStream | null>(null);

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

        // 6. utiliser le stream pré-join (prévisualisation)
        let localStream = preJoinStream;
        if (!localStream) {
          // fallback: demander si pas de stream (ne devrait pas arriver)
          localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
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
  }, [joined, roomId, userId, preJoinStream]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-white dark:from-gray-900 dark:via-indigo-950 dark:to-gray-900 transition-colors">
      <div className="p-8 bg-white/80 dark:bg-gray-900/80 rounded-2xl shadow-2xl max-w-5xl w-full backdrop-blur-md border border-gray-200 dark:border-gray-800">
        <h2 className="text-2xl font-extrabold mb-6 text-center text-gray-900 dark:text-white tracking-tight drop-shadow-lg">Salle : <span className="font-mono text-indigo-600 dark:text-indigo-300">{roomId}</span></h2>
        {!joined ? (
          <RoomJoinConfirmation
            roomId={roomId as string}
            onJoin={(stream) => {
              setPreJoinStream(stream);
              setJoined(true);
            }}
          />
        ) : (
          <div className="flex flex-col md:flex-row gap-8 items-stretch justify-center w-full animate-fade-in">
            {/* Votre caméra */}
            <div className="flex-1 flex flex-col items-center bg-white/60 dark:bg-gray-800/60 rounded-xl shadow-lg p-6 mb-4 md:mb-0 border border-gray-100 dark:border-gray-800">
              <h4 className="text-lg font-semibold mb-3 text-indigo-700 dark:text-indigo-300 tracking-wide">Votre caméra</h4>
              <div className="w-64 h-48 rounded-lg overflow-hidden bg-black shadow-inner mb-2 border-2 border-indigo-200 dark:border-indigo-700">
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Vous</div>
            </div>
            {/* Flux distants */}
            <div className="flex-1 flex flex-col items-center bg-white/60 dark:bg-gray-800/60 rounded-xl shadow-lg p-6 border border-gray-100 dark:border-gray-800">
              <h4 className="text-lg font-semibold mb-3 text-purple-700 dark:text-purple-300 tracking-wide">Participants</h4>
              <div className="flex flex-wrap gap-6 justify-center">
                {remoteStreams.length === 0 && (
                  <div className="text-gray-400 italic text-sm">Aucun autre participant pour l'instant…</div>
                )}
                {/* Grouper les flux par userId */}
                {Object.entries(
                  remoteStreams.reduce((acc, s) => {
                    if (!acc[s.userId]) acc[s.userId] = {};
                    if (s.kind === 'video' || s.kind === 'audio') {
                      acc[s.userId][s.kind] = s;
                    }
                    return acc;
                  }, {} as Record<string, { video?: RemoteStream; audio?: RemoteStream }>)
                ).map(([userId, streams]) => (
                  <div key={userId} className="flex flex-col items-center">
                    <div className="w-40 h-32 rounded-lg overflow-hidden bg-black shadow border-2 border-purple-200 dark:border-purple-700 flex items-center justify-center">
                      {streams.video ? (
                        <video
                          autoPlay
                          playsInline
                          ref={el => {
                            if (el) el.srcObject = streams.video!.stream;
                          }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500 text-3xl bg-black/60">
                          <span className="font-bold">{userId.slice(0, 2).toUpperCase()}</span>
                        </div>
                      )}
                      {/* Audio invisible si présent */}
                      {streams.audio && (
                        <audio
                          autoPlay
                          ref={el => {
                            if (el) el.srcObject = streams.audio!.stream;
                          }}
                          style={{ display: 'none' }}
                        />
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 text-white font-bold text-xs shadow">
                        {userId.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-700 dark:text-gray-300 font-mono">{userId.slice(0, 8)}…</span>
                      {streams.video && <span className="text-[10px] text-gray-400">vidéo</span>}
                      {streams.audio && !streams.video && <span className="text-[10px] text-gray-400">audio</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {error && <div className="text-red-600 mt-4 text-center font-semibold">{error}</div>}
      </div>
    </main>
  );
}
