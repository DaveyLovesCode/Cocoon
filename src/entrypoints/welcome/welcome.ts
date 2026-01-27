import '../../app.css';
import Welcome from './Welcome.svelte';
import { mount } from 'svelte';

mount(Welcome, {
  target: document.getElementById('app')!,
});
