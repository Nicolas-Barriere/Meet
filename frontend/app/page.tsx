"use client";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import React, { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [roomIdInput, setRoomIdInput] = useState("");

  const handleCreate = () => {
    const newRoomId = uuidv4();
    router.push(`/${newRoomId}`);
  };

  const handleJoin = () => {
    if (roomIdInput.trim()) {
      router.push(`/${roomIdInput.trim()}`);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-100 to-indigo-200">
      <div className="bg-white rounded-xl shadow-lg p-8 flex flex-col gap-6 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center text-indigo-700">Meet</h1>
        <button onClick={handleCreate} className="bg-indigo-600 text-white rounded-lg py-3 font-semibold hover:bg-indigo-700 transition">Créer une visio</button>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ID de la visio"
            value={roomIdInput}
            onChange={e => setRoomIdInput(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2"
          />
          <button onClick={handleJoin} className="bg-indigo-500 text-white rounded-lg px-4 py-2 hover:bg-indigo-600 transition">Rejoindre</button>
        </div>
      </div>
    </main>
  );
}
