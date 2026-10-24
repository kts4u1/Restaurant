// Cloudflare Pages Functions: /api/ 아래 모든 요청 → src/cloudflare.js
import { handleApiRequest } from '../../src/cloudflare.js';

export const onRequest = ({ request, env }) => handleApiRequest(request, env);
