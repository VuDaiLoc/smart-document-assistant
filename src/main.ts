import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app.component';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';

try {
  Amplify.configure(outputs);
  console.log('Amplify configured successfully');
} catch (e) {
  console.error('Failed to configure Amplify:', e);
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
