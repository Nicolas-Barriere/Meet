"use client";
import React, { useEffect, useRef, useState } from "react";

interface RoomJoinConfirmationProps {
  roomId: string;
  onJoin: (stream: MediaStream | null) => void;
}

export default function RoomJoinConfirmation({ roomId, onJoin }: RoomJoinConfirmationProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    setLoading(true);
    setError(null);
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => {
        stream = s;
        setLocalStream(s);
        setLoading(false);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(e => {
        setError("Impossible d'accéder à la caméra ou au micro. Autorisez l'accès pour prévisualiser.");
        setLoading(false);
      });
    // Ne pas stopper les tracks ici : le flux doit rester vivant pour la room
    return () => {};
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 animate-fade-in">
      <div className="w-full flex flex-col items-center">
        <div className="w-32 h-32 rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-800 shadow-lg mb-4 flex items-center justify-center relative">
          {loading ? (
            <div className="text-gray-400">Chargement...</div>
          ) : error ? (
            <div className="text-xs text-red-500 text-center px-2">{error}</div>
          ) : (
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover bg-black" />
          )}
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">Prêt à rejoindre la visioconférence ?</h2>
        <p className="text-gray-600 dark:text-gray-300 text-center mb-4">
          Vous pouvez vérifier votre caméra avant d'entrer dans la salle <span className='font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded'>{roomId}</span>.
        </p>
        <button
          onClick={() => onJoin(localStream)}
          disabled={loading || !!error}
          className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            Rejoindre la visio
          </span>
        </button>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 text-center">
          En rejoignant, vous autorisez l'accès à votre caméra et microphone.
        </p>
      </div>
    </div>
  );
}
