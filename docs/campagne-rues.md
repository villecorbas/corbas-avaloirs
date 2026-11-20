# Campagne « Adoptez une rue » — mise en place

Objectif : des habitants s'inscrivent pour cartographier les avaloirs d'une rue de Corbas (plusieurs personnes par rue possibles), et la mairie peut les relancer par e-mail si la rue n'avance pas. Une centaine d'inscrits : un **Google Form + Google Sheets** suffit, sans serveur à part.

## Ce que fait l'application

- Écran **Adoptez une rue** (onglet Défis, ou Réglages) : toutes les rues nommées de Corbas (OpenStreetMap), avancement de chacune (part de sa longueur à moins de 35 m d'un avaloir connu), recherche, filtres « À faire » et « Sans inscrit ».
- Bouton **Je m'engage** : ouvre le formulaire Google avec la rue déjà choisie.
- Compteur d'inscrits par rue (public, sans aucune donnée personnelle) si `statsUrl` est renseigné.
- Notice « Protection de vos données » intégrée.
- Lien de campagne à diffuser sur les réseaux : `https://villecorbas.github.io/corbas-avaloirs/?rues` (ouvre directement l'écran après l'accueil).
- Bouton « Exporter l'avancement (CSV) » : sert aux relances (voir plus bas).

## Mise en place (environ 30 minutes)

Pour la conformité, utilisez **le compte Google de la mairie** (idéalement Google Workspace, dont les conditions incluent un accord de traitement des données), pas un compte personnel.

1. Allez sur script.google.com (compte de la mairie) > **Nouveau projet**, collez le contenu de `docs/campagne/apps-script.gs`, adaptez le bloc `CONFIG` (adresse e-mail de contact notamment) et enregistrez.
2. Exécutez `creerFormulaire` (autorisez le script). Dans **Affichage > Journaux**, notez l'adresse publiée du formulaire et celle du classeur des réponses. Si Overpass est indisponible, réessayez plus tard. Cette étape ne se fait qu'une fois.
3. Ouvrez le **classeur des réponses** : renommez l'onglet de réponses en **Réponses**, ajoutez les titres `Statut`, `Relances`, `Dernière relance` en colonnes F, G, H, et créez un onglet **Avancement** (titres : `rue`, `couverture_pct`, `longueur_m`). Puis **Extensions > Apps Script** *de ce classeur* et collez **de nouveau le même script** (sans relancer `creerFormulaire`) : c'est ce projet-là qui gère le menu « Campagne », les relances, la purge et les compteurs.
4. **Pré-remplissage de la rue** : dans le formulaire, menu ⋮ > *Obtenir un lien pré-rempli*, choisissez une rue, cliquez « Obtenir le lien » : l'adresse contient `entry.123456789=…`. Notez ce `entry.…`.
5. **Compteurs publics** : dans l'Apps Script du classeur de réponses, *Déployer > Nouveau déploiement > Application Web*, exécuter en tant que **moi**, accès **tout le monde**. Notez l'adresse `https://script.google.com/macros/s/…/exec` : elle ne renvoie que `{ "counts": { "nom de rue": nombre } }`.
6. Renseignez `public/config.js` (bloc `campaign`) : `formUrl`, `streetEntry`, `statsUrl`, `contactEmail` (et `privacyUrl` si la commune a une page dédiée), puis publiez (commit sur `main`).
7. Partagez le classeur des réponses **uniquement** avec les 1 ou 2 personnes habilitées (ne jamais « toute personne disposant du lien »).

## Relancer les inscrits dont la rue n'avance pas

1. Dans l'application : écran *Adoptez une rue* > **Exporter l'avancement (CSV)**.
2. Collez le contenu (sans l'en-tête) dans l'onglet **Avancement** du classeur de réponses.
3. Menu **Campagne > Relances : voir qui serait relancé (essai)** : rien n'est envoyé, on voit le nombre de messages.
4. Menu **Campagne > Relances : envoyer maintenant**.

Règles appliquées : seuls les inscrits **ayant consenti** et non désinscrits sont relancés ; uniquement si leur rue est couverte à moins de 90 % ; première relance 14 jours après l'inscription, puis tous les 14 jours, **3 relances au maximum**. Chaque e-mail indique d'où vient le message et comment s'opposer (répondre « STOP » ou écrire à la mairie). Gmail limite l'envoi à ~100 e-mails par jour avec un compte gratuit (1 500 avec Workspace) : largement suffisant ici.

## RGPD : check-list

| Point | Dans cette solution |
|---|---|
| Responsable du traitement | La commune de Corbas (à indiquer dans le registre des traitements ; informer le DPO s'il existe). |
| Données collectées (minimisation) | Prénom/pseudo, e-mail, rue choisie, horodatage. Pas de téléphone, pas d'adresse postale. |
| Base légale | **Consentement** (case à cocher obligatoire, non pré-cochée) pour l'inscription et les rappels. |
| Information | Texte de protection des données en tête du formulaire et dans l'application (Écran > Protection de vos données). |
| Conservation | Effacement automatique après 6 mois (`purger`, à programmer : Apps Script > Déclencheurs > mensuel). |
| Droits (accès, rectification, effacement, opposition) | Réponse à l'adresse de contact ; menu *Campagne > EFFACER la ligne sélectionnée* ; *Désinscrit* stoppe les relances. |
| Sécurité | Classeur privé, 1-2 personnes habilitées, compte mairie avec validation en deux étapes. |
| Sous-traitant | Google (hébergement du formulaire et du classeur) : vérifier l'accord de traitement et les clauses sur les transferts hors UE dans la console d'administration Workspace. |
| Données publiques | Les relevés (position, photo) sont publiés sur OpenStreetMap/Panoramax : c'est indépendant de cette inscription et indiqué dans la notice. |

⚠️ Ce document est une aide technique, pas un avis juridique : faites valider la notice et le registre des traitements par le DPO ou le délégué de la commune.

## Idées de communication

- Lien unique par réseau (WhatsApp, Facebook) : `…/?rues`.
- « Rues sans inscrit » : le filtre de l'application permet de repérer les rues à promouvoir en priorité (ex. publication « Cette semaine, on cherche des volontaires pour… »).
- Une rue terminée passe en vert « Terminée » : à relayer comme un résultat de la campagne.
