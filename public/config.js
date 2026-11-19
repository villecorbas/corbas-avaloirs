/*
 * Configuration de l'application « Chasse aux avaloirs ».
 * Ce fichier est lu au démarrage : il peut être modifié directement sur le
 * serveur, sans recompiler l'application. Voir README.md pour le détail.
 */
window.AVALOIRS_CONFIG = {
  // Nom affiché de la campagne (écran d'accueil, profil).
  campaignName: 'Chasse aux avaloirs',

  // Commune ciblée. Laisser insee vide pour la détecter automatiquement
  // à partir de la position du premier relevé (Base Adresse Nationale).
  commune: {
    insee: '69273',
    name: 'Corbas',
    // Nombre estimé d'avaloirs sur la commune : sert à la jauge collective.
    estimatedDrains: 1500,
    // Centre de la commune (la carte s'y ouvre sur ordinateur, sans GPS).
    center: { lat: 45.6697, lon: 4.8967 },
  },

  // Objectif quotidien individuel (anneau de progression).
  dailyGoal: 5,

  openstreetmap: {
    // 'production' (openstreetmap.org) ou 'dev' (serveur de test, conseillé pour les essais).
    environment: 'production',
    // Identifiant de l'application OAuth 2 enregistrée sur
    // https://www.openstreetmap.org/oauth2/applications (client « public », sans secret).
    clientId: 'cB5_OVQGhlAox3QpQrlDuTlOmiYlZK3STwnUdaPc1XQ',
    clientIdDev: '',
    // Facultatif : URL de retour OAuth. Par défaut, l'adresse de l'application.
    redirectUri: '',
    hashtags: ['#avaloirs', '#moustiquetigre'],
    // Caniveaux à grille (rigoles linéaires couvertes d'une grille) :
    //  'way'  : tracés en ligne waterway=drainage_gutter + covered=yes
    //           (schéma proposé par la communauté OSM, voir README) — par défaut ;
    //  'node' : point inlet=grate + length=* (tags documentés uniquement) ;
    //  'none' : non publiés dans OSM (photo Panoramax et export seulement).
    channelDrainTagging: 'way',
  },

  panoramax: {
    // Instance Panoramax d'OpenStreetMap France : connexion avec le compte OSM.
    instance: 'https://panoramax.openstreetmap.fr',
  },

  // Serveurs Overpass interrogés pour afficher les avaloirs déjà cartographiés.
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ],
};
