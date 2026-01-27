import '../../app.css';
import Logs from './Logs.svelte';
import { mount } from "svelte";

mount(Logs, {
  target: document.getElementById('app')!,
});
