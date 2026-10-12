import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>({plugins:[react()],envDir:'../..',server:{fs:{allow:['../..']}},define:{__SITE_BUILD__:JSON.stringify('vibogruppen')},build:{outDir:'dist'},}));
