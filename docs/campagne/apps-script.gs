/**
 * Campagne « Mes rues à relever » : script Google Apps Script à coller dans le classeur Google Sheets
 * lié au formulaire (Extensions > Apps Script). Mode d'emploi complet : docs/campagne-rues.md
 *
 * Ce que fait ce script :
 *  1. creerFormulaire()  : crée le formulaire (rues à cocher, une ou plusieurs ; consentement obligatoire) et son classeur.
 *  2. doGet()            : publie UNIQUEMENT le nombre d'inscrits par rue (aucune donnée personnelle).
 *  3. relancer()         : e-mail de rappel aux inscrits dont la rue n'avance pas (avec lien d'opposition).
 *  4. purger()           : efface les inscriptions plus anciennes que la durée de conservation.
 *  5. menu « Campagne »  : désinscrire / effacer la ligne sélectionnée (droits RGPD).
 *
 * Aucune donnée n'est envoyée ailleurs que dans le compte Google de la mairie et chez les destinataires des e-mails.
 */

// ----------------------------- À ADAPTER -----------------------------
var CONFIG = {
  COMMUNE_INSEE: '69273',
  COMMUNE_NOM: 'Corbas',
  APP_URL: 'https://villecorbas.github.io/corbas-avaloirs/?rues',
  CONTACT_MAIRIE: 'contact@exemple-mairie.fr', // adresse affichée dans le formulaire et les e-mails
  SEUIL_RELANCE_PCT: 90, // on relance tant que la rue est couverte à moins de ce pourcentage
  JOURS_AVANT_PREMIERE_RELANCE: 14, // après l'inscription
  JOURS_ENTRE_RELANCES: 14,
  RELANCES_MAX: 3,
  CONSERVATION_MOIS: 6, // effacement automatique après cette durée (à compter de l'inscription)
  FEUILLE_REPONSES: 'Réponses', // nom de l'onglet des réponses du formulaire
  FEUILLE_AVANCEMENT: 'Avancement' // onglet à remplir avec l'export CSV de l'appli (rue;couverture_pct;longueur_m)
};
// ---------------------------------------------------------------------

// Colonnes du classeur de réponses (ordre créé par creerFormulaire).
var COL = { HORODATAGE: 1, PRENOM: 2, EMAIL: 3, RUE: 4, // colonne « Rues » : une ou plusieurs rues
   CONSENTEMENT: 5, STATUT: 6, RELANCES: 7, DERNIERE_RELANCE: 8 };

/** 1. Crée le formulaire. À lancer une seule fois. */
function creerFormulaire() {
  var rues = ruesDeLaCommune_();
  var form = FormApp.create('Mes rues à relever à ' + CONFIG.COMMUNE_NOM + ' — Chasse aux avaloirs');
  form.setDescription(
    'Je m’engage à relever les avaloirs d’une rue de ' + CONFIG.COMMUNE_NOM + ' avec l’application « Chasse aux avaloirs » ' +
    'pour lutter contre le moustique tigre. Plusieurs personnes peuvent choisir la même rue.\n\n' +
    'PROTECTION DE VOS DONNÉES — Responsable du traitement : commune de ' + CONFIG.COMMUNE_NOM + '. ' +
    'Données collectées : prénom ou pseudo, adresse e-mail, rue choisie. Finalité : gérer votre inscription et vous envoyer, ' +
    'si la rue n’avance pas, un rappel par e-mail. Aucun usage commercial, aucune transmission à des tiers. ' +
    'Conservation : jusqu’à la fin de la campagne, effacement au plus tard ' + CONFIG.CONSERVATION_MOIS + ' mois après votre inscription. ' +
    'Vos droits (accès, rectification, effacement, opposition) : ' + CONFIG.CONTACT_MAIRIE + ' ; vous pouvez aussi saisir la CNIL (cnil.fr).'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setConfirmationMessage('Merci ! Votre inscription est enregistrée. Vous pouvez commencer dès maintenant dans l’application : ' + CONFIG.APP_URL);

  form.addTextItem().setTitle('Prénom ou pseudo').setRequired(true);
  form.addTextItem().setTitle('Adresse e-mail').setHelpText('Utilisée uniquement pour confirmer votre inscription et vous envoyer un rappel si besoin.')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextMatchesPattern('^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$').setHelpText('Adresse e-mail invalide').build());
  form.addCheckboxItem().setTitle('Rues').setHelpText('Vous pouvez en choisir plusieurs.').setChoiceValues(rues).setRequired(true);
  form.addCheckboxItem().setTitle('Consentement')
    .setChoiceValues(['J’accepte que la commune de ' + CONFIG.COMMUNE_NOM + ' enregistre ces informations et m’envoie un rappel par e-mail si ma rue n’avance pas.'])
    .setRequired(true);

  var ss = SpreadsheetApp.create('Mes rues à relever — réponses (données personnelles)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  Logger.log('Formulaire : ' + form.getEditUrl());
  Logger.log('Adresse à publier (champ formUrl) : ' + form.getPublishedUrl());
  Logger.log('Classeur (À GARDER PRIVÉ, partagé seulement avec les personnes habilitées) : ' + ss.getUrl());
  Logger.log('Ensuite : renommer l’onglet de réponses en « ' + CONFIG.FEUILLE_REPONSES + ' », ajouter les colonnes F:H (Statut, Relances, Dernière relance), créer l’onglet « ' + CONFIG.FEUILLE_AVANCEMENT + ' ». Voir docs/campagne-rues.md.');
}

/** Voies de la commune d'après la Base Adresse Nationale (référentiel de l'État, open data), triées, sans doublon. */
function ruesDeLaCommune_() {
  var res = UrlFetchApp.fetch('https://plateforme.adresse.data.gouv.fr/lookup/' + CONFIG.COMMUNE_INSEE, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Base Adresse Nationale indisponible (' + res.getResponseCode() + '), réessayez dans quelques minutes.');
  var seen = {};
  (JSON.parse(res.getContentText()).voies || []).forEach(function (v) {
    if (v.type === 'voie' && v.nomVoie) seen[String(v.nomVoie).replace(/\s+/g, ' ').trim()] = true;
  });
  var list = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
  if (!list.length) throw new Error('Aucune voie trouvée pour le code INSEE ' + CONFIG.COMMUNE_INSEE);
  return list;
}

/** Rues choisies par une personne : la cellule contient « Rue A, Rue B » (cases cochées, séparées par une virgule). */
function ruesDe_(cellule, connues) {
  var texte = String(cellule || '');
  var trouvees = [];
  Object.keys(connues).forEach(function (nom) { if (texte.indexOf(nom) !== -1) trouvees.push(nom); });
  // « Rue de la Gare » est contenu dans « Rue de la Gare Nord » : on ne garde que les noms les plus longs
  return trouvees.filter(function (n) { return !trouvees.some(function (m) { return m !== n && m.indexOf(n) !== -1 && texte.indexOf(m) !== -1; }); });
}

/** Clé de comparaison identique à celle de l'application (sans accents, minuscules, ponctuation). */
function cle_(nom) {
  return String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function lignes_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.FEUILLE_REPONSES);
  if (!sh) throw new Error('Onglet « ' + CONFIG.FEUILLE_REPONSES + ' » introuvable.');
  var n = sh.getLastRow() - 1;
  return { sh: sh, rows: n > 0 ? sh.getRange(2, 1, n, 8).getValues() : [] };
}

/** Voies connues (BAN), en cache 6 h pour ne pas interroger le service à chaque appel. */
function ruesConnues_() {
  var cache = CacheService.getScriptCache();
  var brut = cache.get('rues');
  var liste = brut ? JSON.parse(brut) : ruesDeLaCommune_();
  if (!brut) cache.put('rues', JSON.stringify(liste), 21600);
  var out = {};
  liste.forEach(function (n) { out[n] = true; });
  return out;
}

/** 2. Application web (déployer en « Application Web », accès : tout le monde). Aucune donnée personnelle. */
function doGet() {
  var counts = {};
  var connues = ruesConnues_();
  lignes_().rows.forEach(function (r) {
    if (!r[COL.EMAIL - 1] || r[COL.STATUT - 1] === 'Désinscrit') return;
    ruesDe_(r[COL.RUE - 1], connues).forEach(function (nom) {
      var k = cle_(nom);
      counts[k] = (counts[k] || 0) + 1; // une personne compte une fois par rue choisie
    });
  });
  return ContentService.createTextOutput(JSON.stringify({ counts: counts })).setMimeType(ContentService.MimeType.JSON);
}

/** Avancement par rue (onglet « Avancement », collé depuis l'export CSV de l'application). */
function avancement_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.FEUILLE_AVANCEMENT);
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0] !== '' && r[1] !== '') map[cle_(r[0])] = Number(r[1]) || 0; });
  return map;
}

/** 3. Relances. À lancer à la main (ou avec un déclencheur hebdomadaire). Mode essai : relancer(true) n'envoie rien. */
function relancer(essai) {
  var av = avancement_();
  if (!Object.keys(av).length) throw new Error('Onglet « ' + CONFIG.FEUILLE_AVANCEMENT + ' » vide : collez d’abord l’export CSV de l’application.');
  var connues = ruesConnues_();
  var now = new Date();
  var jour = 86400000;
  var envoyes = 0;
  var data = lignes_();
  data.rows.forEach(function (r, i) {
    var email = r[COL.EMAIL - 1], statut = r[COL.STATUT - 1], nb = Number(r[COL.RELANCES - 1]) || 0, derniere = r[COL.DERNIERE_RELANCE - 1];
    if (!email || statut === 'Désinscrit' || nb >= CONFIG.RELANCES_MAX) return;
    if (!r[COL.CONSENTEMENT - 1]) return; // pas de consentement enregistré : pas de relance
    // Rues choisies qui n'avancent pas (avancement connu et sous le seuil)
    var enRetard = ruesDe_(r[COL.RUE - 1], connues).filter(function (nom) {
      var pct = av[cle_(nom)];
      return pct !== undefined && pct < CONFIG.SEUIL_RELANCE_PCT;
    });
    if (!enRetard.length) return;
    var depuis = derniere ? derniere : r[COL.HORODATAGE - 1];
    var delai = derniere ? CONFIG.JOURS_ENTRE_RELANCES : CONFIG.JOURS_AVANT_PREMIERE_RELANCE;
    if (now - new Date(depuis) < delai * jour) return;
    if (!essai) {
      var detail = enRetard.map(function (nom) { return '• ' + nom + ' : ' + av[cle_(nom)] + ' % relevé'; }).join('\n');
      MailApp.sendEmail({
        to: email,
        replyTo: CONFIG.CONTACT_MAIRIE,
        subject: (enRetard.length > 1 ? 'Vos rues vous attendent' : 'Votre rue vous attend') + ' (' + CONFIG.COMMUNE_NOM + ')',
        body: 'Bonjour ' + r[COL.PRENOM - 1] + ',\n\n' +
              'Vous vous êtes engagé(e) à relever les avaloirs de ' + (enRetard.length > 1 ? 'ces rues' : 'cette rue') + ' pour lutter contre le moustique tigre :\n' +
              detail + '\n\nQuelques minutes suffisent :\n' + CONFIG.APP_URL + '\n\n' +
              'Merci pour votre aide !\n' + 'La mairie de ' + CONFIG.COMMUNE_NOM + '\n\n' +
              '—\nVous recevez ce message parce que vous vous êtes inscrit(e) à la campagne « Mes rues à relever ». ' +
              'Pour ne plus recevoir de rappel ou faire effacer vos données, répondez simplement « STOP » à ce message ou écrivez à ' + CONFIG.CONTACT_MAIRIE + '.'
      });
      data.sh.getRange(i + 2, COL.RELANCES).setValue(nb + 1);
      data.sh.getRange(i + 2, COL.DERNIERE_RELANCE).setValue(now);
    }
    envoyes++;
  });
  Logger.log((essai ? 'ESSAI — messages qui seraient envoyés : ' : 'Messages envoyés : ') + envoyes);
  return envoyes;
}

/** 4. Effacement des inscriptions trop anciennes (déclencheur mensuel conseillé). */
function purger() {
  var limite = new Date();
  limite.setMonth(limite.getMonth() - CONFIG.CONSERVATION_MOIS);
  var data = lignes_();
  var supprimees = 0;
  for (var i = data.rows.length - 1; i >= 0; i--) {
    var h = data.rows[i][COL.HORODATAGE - 1];
    if (h && new Date(h) < limite) { data.sh.deleteRow(i + 2); supprimees++; }
  }
  Logger.log('Lignes effacées : ' + supprimees);
}

/** 5. Menu « Campagne » dans le classeur. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Campagne')
    .addItem('Relances : voir qui serait relancé (essai)', 'menuEssai_')
    .addItem('Relances : envoyer maintenant', 'menuRelancer_')
    .addSeparator()
    .addItem('Marquer la ligne sélectionnée « Désinscrit »', 'menuDesinscrire_')
    .addItem('EFFACER la ligne sélectionnée (droit à l’effacement)', 'menuEffacer_')
    .addItem('Purger les inscriptions anciennes', 'purger')
    .addToUi();
}
function menuEssai_() { SpreadsheetApp.getUi().alert(relancer(true) + ' message(s) seraient envoyés. Rien n’a été envoyé.'); }
function menuRelancer_() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Envoyer les relances maintenant ?', ui.ButtonSet.YES_NO) === ui.Button.YES) ui.alert(relancer(false) + ' message(s) envoyés.');
}
function ligneChoisie_() {
  var sh = SpreadsheetApp.getActiveSheet();
  var r = sh.getActiveRange().getRow();
  if (sh.getName() !== CONFIG.FEUILLE_REPONSES || r < 2) throw new Error('Sélectionnez une ligne de l’onglet « ' + CONFIG.FEUILLE_REPONSES + ' ».');
  return { sh: sh, row: r };
}
function menuDesinscrire_() { var l = ligneChoisie_(); l.sh.getRange(l.row, COL.STATUT).setValue('Désinscrit'); }
function menuEffacer_() {
  var l = ligneChoisie_();
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Effacer définitivement cette ligne ?', ui.ButtonSet.YES_NO) === ui.Button.YES) l.sh.deleteRow(l.row);
}
