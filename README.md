# Backend API Documentation

## Endpoints

### Game
- `GET /api/game/state/:userId` - Get user game state

### Auth
- `POST /api/auth/magic-link` - Request magic link
- `GET /api/auth/verify/:token` - Verify magic link token

### Chat
- `GET /api/chat/messages` - Get recent chat messages

### Shop
- `GET /api/shop/items` - Get shop items
- `POST /api/shop/checkout` - Create Stripe checkout session

## Socket.io Events

### Client → Server
- `start-round` - Start a new round
- `fold-round` - Fold current round
- `chat-message` - Send chat message

### Server → Client
- `round-started` - Round has started
- `multiplier-update` - Multiplier update during round
- `round-folded` - Round was folded
- `chat-message` - New chat message

## Database Models

### User
- email, username, rank, xp, gold, metal, verified, wagerCap, oracleLevel, vaultLevel

### Round
- userId, wager, targetMultiplier, duration, finalMultiplier, status

### ChatMessage
- userId, username, rank, message, standing, isSystem

### MercyPot
- total, velocity, lastUpdated
