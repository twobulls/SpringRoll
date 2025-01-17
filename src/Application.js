import { Debugger } from './debug/Debugger.js';
import { HintSequencePlayer } from './hints/HintSequencePlayer.js';
import { Property } from './state/Property.js';
import { BellhopSingleton } from './communication/BellhopSingleton';

const pause = 'pause';
const captionsMuted = 'captionsMuted';
const soundVolume = 'soundVolume';
const musicVolume = 'musicVolume';
const voVolume = 'voVolume';
const sfxVolume = 'sfxVolume';
const playHelp = 'playHelp';

/**
 * Main entry point for a game. Provides a single focal point for plugins and functionality to attach.
 * @class Application
 */
export class Application {
  /**
   * @param {Object} [config={}]  Root configuration object for various internal Application objects
   * @param {Object} [config.hintPlayer = HintSequencePlayer] IHintPlayer application will use.
   * @param {Object} [config.features={}] A configuration object denoting which features are enabled for this application
   * @param {Boolean} [config.features.captions] A boolean value denoting that this game supports captions
   * @param {Boolean} [config.features.sound] A boolean value denoting that this game has some audio in it
   * @param {Boolean} [config.features.vo] A boolean denoting that this game has mutable voice-over audio in it
   * @param {Boolean} [config.features.music] A boolean denoting that this game has mutable music in it
   * @param {Boolean} [config.features.sfx] A boolean denoting that this game has mutable sound effects in it
   * @param {Boolean} [config.features.soundVolume] A boolean denoting that this game has adjustable sound volume in it
   * @param {Boolean} [config.features.musicVolume] A boolean denoting that this game has adjustable music volume in it
   * @param {Boolean} [config.features.voVolume] A boolean denoting that this game has adjustable voice-over volume in it
   * @param {Boolean} [config.features.sfxVolume] A boolean denoting that this game has adjustable sound effects volume in it
   */
  constructor({ features, hintPlayer = new HintSequencePlayer() } = {}) {
    this.state = {
      ready: new Property(false),
      pause: new Property(false),
      captionsMuted: new Property(true),
      playOptions: new Property({}),
      soundVolume: new Property(1),
      musicVolume: new Property(1),
      voVolume: new Property(1),
      sfxVolume: new Property(1)
    };

    this.features = Object.assign(
      {
        captions: false,
        sound: false,
        vo: false,
        music: false,
        sfx: false,
        soundVolume: false,
        musicVolume: false,
        voVolume: false,
        sfxVolume: false
      },
      features || {}
    );

    // always enable sound if one of the sound channels is enabled
    if (this.features.vo || this.features.music || this.features.sfx) {
      this.features.sound = true;
    }

    // create the connection to the container (if possible), and report features and SpringRoll 1 compat data
    this.container = BellhopSingleton;
    this.container.connect();
    this.container.send('features', this.features);
    this.container.send('keepFocus', false);

    // listen for events from the container and keep the local value in sync
    {
      const events = [
        soundVolume,
        musicVolume,
        voVolume,
        sfxVolume,
        captionsMuted,
        pause
      ];
      const length = events.length;
      for (let i = 0; i < length; i++) {
        const property = this.state[events[i]];
        this.container.on(
          events[i],
          containerEvent => (property.value = containerEvent.data)
        );
      }
    }

    // listen for legacy mute events from the container and map them to volume properties
    {
      const legacyListeners = [
        { mute: 'soundMuted', volume: soundVolume },
        { mute: 'musicMuted', volume: musicVolume },
        { mute: 'voMuted', volume: voVolume },
        { mute: 'sfxMuted', volume: sfxVolume }
      ];

      for (let i = 0; i < legacyListeners.length; i++) {
        const property = this.state[legacyListeners[i].volume];
        this.container.on(legacyListeners[i].mute, containerEvent => {
          const previousValue = property._previousValue || 1;
          property._previousValue = property.value;
          property.value = containerEvent.data ? 0 : previousValue;
        });
      }
    }

    // maintain focus sync between the container and application
    window.addEventListener('focus', () => this.container.send('focus', true));
    window.addEventListener('blur', () => this.container.send('focus', false));

    // attempt to fetch play options from the query string (passed by the Container)
    const match = /playOptions=[^&$]*/.exec(window.location.search);
    if (match !== null) {
      const matchedToken = match[0];
      const rawValue = decodeURIComponent(matchedToken.split('=')[1]);

      try {
        this.state.playOptions.value = JSON.parse(rawValue);
      } catch (e) {
        Debugger.log(
          'warn',
          'Failed to parse playOptions from query string:' + e.message
        );
      }
    }

    // Also attempt to fetch over the iframe barrier for old container support
    this.container.fetch(
      'playOptions',
      e => (this.state.playOptions.value = e.data)
    );

    this.setupPlugins()
      .catch(e => {
        Debugger.log('warn', e);
      })
      .then(() => {
        this.validateListeners();
      })
      .catch(e => {
        Debugger.log('warn', e);
      })
      .then(() => {
        this.container.send('loaded');
        this.state.ready.value = true;
      });

    //register bellhop event for hints.
    this.hints = hintPlayer;
    this.container.on(playHelp, () => {
      if (!this.hints) {
        Debugger.log(
          'warn',
          '[Springroll] Missing IHintPlayer see: https://github.com/SpringRoll/SpringRoll/tree/v2/src/hints'
        ); // <-- this could only happen if devs set this.hints manually.
        return;
      }

      this.hints.play();
    });
  }

  /**
   * preloads, initializes and starts plugins.
   * @return {Promise<void>}
   * @memberof Application
   */
  setupPlugins() {
    const preloads = [];

    for (let i = 0; i < Application._plugins.length; i++) {
      if (!Application._plugins[i].preload) {
        return;
      }

      preloads.push(
        Application._plugins[i]
          .preload(this)
          .catch(function preloadFail(error) {
            Application._plugins[i].preloadFailed = true;
            console.warn(
              Application._plugins[i].name,
              'Preload Failed:',
              error
            );
          })
      );
    }

    // ~wait for all preloads to resolve
    return Promise.all(preloads).then(() => {
      // Remove plugins that fail to load.
      Application._plugins = Application._plugins.filter(
        plugin => plugin.preloadFailed !== true
      );

      //init
      for (let i = 0; i < Application._plugins.length; i++) {
        if (!Application._plugins[i].init) {
          return;
        }
        Application._plugins[i].init(this);
      }

      //start
      for (let i = 0; i < Application._plugins.length; i++) {
        if (!Application._plugins[i].start) {
          return;
        }
        Application._plugins[i].start(this);
      }
    });
  }

  /**
   * returns instance of a plugin.
   * @param  {string} name
   * @return {SpringRoll.ApplicationPlugin | undefined}
   * @memberof Application
   */
  getPlugin(name) {
    return Application.getPlugin(name);
  }

  /**
   * Validates that appropriate listeners are added for the features that were enabled in the constructor
   * @throws Error
   */
  validateListeners() {
    const missingListeners = [];

    const featureToStateMap = {
      captions: captionsMuted,
      sound: soundVolume,
      music: musicVolume,
      vo: voVolume,
      sfx: sfxVolume
    };

    const keys = Object.keys(featureToStateMap);

    for (let i = 0; i < keys.length; i++) {
      const stateName = featureToStateMap[keys[i]];

      if (this.features[keys[i]] && !this.state[stateName].hasListeners) {
        missingListeners.push(stateName);
      }
    }

    if (!this.state.pause.hasListeners) {
      missingListeners.push('pause');
    }

    if (missingListeners.length) {
      throw new Error(
        'Application state is missing required listeners: ' +
          missingListeners.join(', ') +
          '.'
      );
    }
  }
}

/**
 * The list of plugins that are currently registered to run on Applications.
 * @static
 */
Application._plugins = [];

/**
 * Registers a plugin to be used by applications, sorting it by priority order.
 * @param {SpringRoll.ApplicationPlugin} plugin The plugin to register.
 */
Application.uses = function(plugin) {
  Application._plugins.push(plugin);
};

/**
 * Finds a plugin by name.
 * @param {string} name The name of the plugin.
 * @returns {SpringRoll.ApplicationPlugin | undefined}
 */
Application.getPlugin = function(name) {
  return Application._plugins.find(function(plugin) {
    return plugin.name === name;
  });
};
