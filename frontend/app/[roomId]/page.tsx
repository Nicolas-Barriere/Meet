'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import * as mediasoupClient from 'mediasoup-client';
import { getRtpCapabilities, createTransport, connectTransport, produce, consume, getProducers, leaveRoom } from '../mediasoupClient';
import { v4 as uuidv4 } from 'uuid';

export default function RoomPage() {
  const { roomId } = useParams();
  const [joined, setJoined] = useState(false);
  const [userId] = useState(uuidv4());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  // remoteStreams: Array<{ producerId, userId, kind, stream }>
  const [remoteStreams, setRemoteStreams] = useState<Array<{ producerId: string; userId: string; kind: string; stream: MediaStream }>>([]);
  const [error, setError] = useState<string | null>(null);
  // Component to render remote video/audio streams
  function RemoteMedia({ kind, stream, producerId }: { kind: string; stream: MediaStream; producerId: string }) {
    const ref = useRef<HTMLMediaElement>(null);
    useEffect(() => {
      const el = ref.current;
      console.log('RemoteMedia useEffect', { kind, producerId, streamId: stream.id, tracks: stream.getTracks().map(t => ({ id: t.id, kind: t.kind, readyState: t.readyState, enabled: t.enabled, muted: t.muted })) });
      if (!el) {
        console.warn('RemoteMedia: element ref not ready', producerId);
        return;
      }
      // Only assign if different to avoid unnecessary resets
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      const onLoaded = () => {
        console.log(`Remote ${kind} loaded metadata`, producerId);
        el.play().then(() => console.log(`Remote ${kind} play success`, producerId)).catch(e => console.warn(`Remote ${kind} play error`, producerId, e));
      };
      const onPlaying = () => {
        console.log(`Remote ${kind} playing`, producerId);
      };
      el.addEventListener('loadedmetadata', onLoaded);
      el.addEventListener('playing', onPlaying);
      return () => {
        el.removeEventListener('loadedmetadata', onLoaded);
        el.removeEventListener('playing', onPlaying);
      };
    }, [stream, kind, producerId]);
    if (kind === 'video') {
      return <video ref={ref as React.RefObject<HTMLVideoElement>} autoPlay playsInline className="rounded-lg border shadow w-64 h-48 bg-black" />;
    }
    return <audio ref={ref as React.RefObject<HTMLAudioElement>} autoPlay controls={false} />;
  }

  useEffect(() => {
    if (!joined) return;
    let device: mediasoupClient.types.Device;
    let sendTransport: mediasoupClient.types.Transport;
    let recvTransport: mediasoupClient.types.Transport;
    let producer: mediasoupClient.types.Producer;
    let consumers: mediasoupClient.types.Consumer[] = [];
    let consumedProducerIds: string[] = [];
    let pollingInterval: NodeJS.Timeout;

    // Cleanup handler for tab close/reload
    const handleLeave = async () => {
      try {
        await leaveRoom(roomId as string, userId);
      } catch (e) {}
    };
    window.addEventListener('beforeunload', handleLeave);

    const start = async () => {
      try {
        // 1. Get RTP Capabilities
        const rtpCapabilities = await getRtpCapabilities();
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });

        // 2. Create send transport
        const sendTransportData = await createTransport(roomId as string, userId);
        sendTransport = device.createSendTransport(sendTransportData);
        sendTransport.on(
          'connect',
          async (
            { dtlsParameters }: { dtlsParameters: any },
            callback: () => void,
            errback: (error: Error) => void
          ) => {
            try {
              await connectTransport(roomId as string, userId, dtlsParameters);
              callback();
            } catch (err: any) {
              errback(err);
            }
          }
        );
        sendTransport.on(
          'produce',
          async (
            { kind, rtpParameters }: { kind: string; rtpParameters: any },
            callback: (data: { id: string }) => void,
            errback: (error: Error) => void
          ) => {
            try {
              const { id } = await produce(roomId as string, userId, sendTransport.id, kind, rtpParameters);
              callback({ id });
            } catch (err: any) {
              errback(err);
            }
          }
        );
        // Debug: log sendTransport state changes
        sendTransport.on('connectionstatechange', state => console.log('sendTransport connection state:', state));

        // 3. Get user media and produce (audio + vidéo)
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        // Produire la vidéo
        const videoTrack = stream.getVideoTracks()[0];
        console.log('Local video track', videoTrack, videoTrack.readyState, videoTrack.enabled, videoTrack.muted);
        producer = await sendTransport.produce({ track: videoTrack });
        // Produire l'audio
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          await sendTransport.produce({ track: audioTrack });
        }

        // 4. Create recv transport
        const recvTransportData = await createTransport(roomId as string, userId);
        recvTransport = device.createRecvTransport(recvTransportData);
        recvTransport.on(
          'connect',
          async (
            { dtlsParameters }: { dtlsParameters: any },
            callback: () => void,
            errback: (error: Error) => void
          ) => {
            try {
              await connectTransport(roomId as string, userId, dtlsParameters);
              callback();
            } catch (err: any) {
              errback(err);
            }
          }
        );

        // 5. Poll for new producers every 2s
        const pollProducers = async () => {
          try {
            const producersList = await getProducers(roomId as string, userId);
            let newStreams: Array<{ producerId: string; userId: string; kind: string; stream: MediaStream }> = [...remoteStreams];
            let newConsumed = false;
            for (let i = 0; i < producersList.length; i++) {
              const { producerId, userId: remoteUserId } = producersList[i];
              if (!consumedProducerIds.includes(producerId)) {
                const consumerData = await consume(roomId as string, userId, producerId, device.rtpCapabilities);
                const consumer = await recvTransport.consume({
                  id: consumerData.id,
                  producerId: consumerData.producerId,
                  kind: consumerData.kind,
                  rtpParameters: consumerData.rtpParameters,
                });
                console.log('Consumer details:', { id: consumer.id, kind: consumer.kind, paused: consumer.paused });
                if (consumer.paused) {
                  await consumer.resume();
                  console.log('Consumer resumed:', consumer.id);
                }
                consumers.push(consumer);
                consumedProducerIds.push(producerId);
                const remoteStream = new MediaStream([consumer.track]);
                console.log('Nouveau flux distant reçu', producerId, consumer.track.kind, consumer.track);
                newStreams = [...newStreams, { producerId, userId: remoteUserId, kind: consumer.track.kind, stream: remoteStream }];
                newConsumed = true;
              }
            }
            if (newConsumed) {
              // Dédupliquer par producerId
              const uniqueStreams = Array.from(
                new Map(newStreams.map(s => [s.producerId, s])).values()
              );
              setRemoteStreams(uniqueStreams);
            }
            // Stop polling if all producers are consumed
            if (producersList.length === consumedProducerIds.length && pollingInterval) {
              clearInterval(pollingInterval);
            }
          } catch (err: any) {
            setError(err.message || 'Erreur lors de la récupération des flux distants');
          }
        };
        await pollProducers(); // initial
        pollingInterval = setInterval(pollProducers, 2000);
      } catch (err: any) {
        setError(err.message || 'Erreur lors de la connexion à la visio');
      }
    };

    start();
    // Cleanup
    return () => {
      producer?.close();
      consumers.forEach(c => c.close());
      sendTransport?.close();
      recvTransport?.close();
      if (pollingInterval) clearInterval(pollingInterval);
      window.removeEventListener('beforeunload', handleLeave);
      // Call leaveRoom on unmount as well
      leaveRoom(roomId as string, userId).catch(() => {});
    };
  }, [joined, userId]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-indigo-100 to-blue-200">
      <div className="bg-white rounded-xl shadow-lg p-8 flex flex-col gap-6 w-full max-w-2xl">
        <h2 className="text-2xl font-bold text-indigo-700 text-center mb-2">Salle : {roomId}</h2>
        {!joined ? (
          <button onClick={() => setJoined(true)} className="bg-indigo-600 text-white rounded-lg py-3 font-semibold hover:bg-indigo-700 transition">Rejoindre la visio</button>
        ) : (
          <div className="flex flex-col md:flex-row gap-6 items-center justify-center">
            <div>
              <h3 className="font-semibold text-center mb-2">Votre caméra</h3>
              <video ref={localVideoRef} autoPlay playsInline muted className="rounded-lg border shadow w-64 h-48 bg-black" />
            </div>
            <div>
              <h3 className="font-semibold text-center mb-2">Flux(s) distant(s)</h3>
              <div className="flex flex-wrap gap-4">
                {/* Grouper par userId, puis afficher video et audio pour chaque */}
                {Array.from(
                  remoteStreams.reduce((acc, s) => {
                    if (!acc.has(s.userId)) acc.set(s.userId, [] as Array<{ producerId: string; userId: string; kind: string; stream: MediaStream }>);
                    acc.get(s.userId)!.push(s);
                    return acc;
                  }, new Map<string, Array<{ producerId: string; userId: string; kind: string; stream: MediaStream }>>())
                ).map(([remoteUserId, streams]) => (
                  <div key={remoteUserId} className="flex flex-col items-center">
                    {streams.filter((s) => s.kind === 'video').map((s) => (
                      <RemoteMedia key={`${s.producerId}-${s.stream.id}`} kind="video" stream={s.stream} producerId={s.producerId} />
                    ))}
                    {streams.filter((s) => s.kind === 'audio').map((s) => (
                      <RemoteMedia key={`${s.producerId}-${s.stream.id}`} kind="audio" stream={s.stream} producerId={s.producerId} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {error && <div className="text-red-600 text-center">{error}</div>}
      </div>
    </main>
  );
}
