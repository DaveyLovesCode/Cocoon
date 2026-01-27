import '../../app.css';
import WhatNew from './WhatNew.svelte';
import { mount } from 'svelte';

mount(WhatNew, {
  target: document.getElementById('app')!,
});
