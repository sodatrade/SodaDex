import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

const target = document.getElementById('root')
if (!target) throw new Error('Missing SodaDEX root element')
mount(App, { target })
