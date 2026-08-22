/* ========================================
   Firebase configuration for cloud sync.

   These values are public identifiers, not secrets - data access
   is enforced by firestore.rules (a signed-in user can only touch
   documents under their own uid).

   All the sadhana apps share ONE Firebase project, so a single
   login works everywhere. `appId` below is the per-app namespace
   (the doc id under users/{uid}/apps/), and `fields` maps this
   app's localStorage keys onto how each one merges across devices.

   Sync is live against the shared 'Sadhana Apps' Firebase project.
   Blanking apiKey/projectId puts sync back to sleep without
   touching anything else - the app stays fully usable offline.
   ======================================== */

window.SADHANA_SYNC_CONFIG = {
  appId: 'shri-rudram',
  deviceKey: 'sr_device_id',
  fields: [
    { name: 'completed', key: 'sr_completed',      merge: 'idset'     },
    { name: 'sadhana',  key: 'sr_sadhana',        merge: 'sadhana'   },
    { name: 'chantPos', key: 'sr_chant_pos',      merge: 'bookmark'  },
  ],
  firebase: {
    apiKey: 'AIzaSyDjhN4HagHlUt0EvTMJd5T-g5N01Ntv95M',
    authDomain: 'sadhana-apps-hd.firebaseapp.com',
    projectId: 'sadhana-apps-hd',
    storageBucket: 'sadhana-apps-hd.firebasestorage.app',
    messagingSenderId: '555145234754',
    appId: '1:555145234754:web:d3bee0ad4b693b06ba60db',
  },
};
