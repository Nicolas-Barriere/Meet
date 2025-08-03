# Backend mediasoup (Express)

- Lance le serveur avec :

```
npm start
```

- Le serveur écoute sur le port 3001 par défaut.
- La configuration mediasoup sera ajoutée dans `index.js`.

# Étapes suivantes

1. Ajouter la logique mediasoup (création de worker, router, transports, etc.).
2. Créer les routes d’API pour le signaling WebRTC.
3. Connecter le frontend Next.js à ce backend via WebSocket ou HTTP selon le besoin.

# Conteneurisation et déploiement

Une fois la logique en place, on ajoutera Dockerfile, docker-compose.yml et Caddyfile.
