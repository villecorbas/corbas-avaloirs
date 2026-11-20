# Campagne « Mes rues à relever »

Objectif : inciter les habitants à relever les avaloirs d'une ou plusieurs rues de Corbas. C'est un **engagement personnel**, volontairement léger : **aucune inscription, aucun compte, aucun serveur, aucune donnée personnelle collectée**. Tout reste sur le téléphone (donc pas de formalités RGPD propres à cette fonction).

## Ce que fait l'application

- Écran **Mes rues à relever** (carte dans l'onglet Défis, ou ligne dans Réglages).
- Liste de toutes les voies de Corbas d'après la **Base Adresse Nationale** (BAN, référentiel de l'État en open data sur adresse.data.gouv.fr, Licence Ouverte), sans les lieux-dits ; recherche et filtres « À faire » / « Mes rues ».
- **Avancement de chaque rue** : part de sa longueur à moins de 35 m d'un avaloir connu (OpenStreetMap + relevés du téléphone). La géométrie vient d'OpenStreetMap, rapprochée de la BAN par le nom ; une voie sans tracé correspondant reste listée avec « Avancement inconnu ». Une rue couverte à 90 % ou plus passe en vert « Terminée ».
- **Je m'engage** : on choisit une ou plusieurs rues (30 au maximum). Le choix est mémorisé sur le téléphone et résumé sur l'onglet Défis (« 2 rues choisies · 35 % relevé »).
- **Inviter mes voisins à m'aider** : partage natif (ou WhatsApp) d'un message « Je m'engage à relever les avaloirs de … » avec un lien qui ouvre directement l'écran ; compte comme une invitation (+5 points, plafonnés comme les autres invitations).

## Dans le tunnel du premier lancement

- Après l'accueil (4 pages), un écran **« Quelle est votre rue ? »** propose de choisir sa rue (recherche par nom) : **+5 points par rue** (jusqu'à 3 rues) et le badge **« Voisin engagé »**. Il est facultatif (« Plus tard »).
- Si la personne l'a ignoré, une carte « Et si vous releviez toute votre rue ? » revient sur l'écran de félicitations après le **1er et le 3e avaloir**.
- L'étape n'apparaît qu'à la fin de l'accueil (donc après les explications sur les objectifs), une seule fois, et jamais seule au lancement d'une appli déjà utilisée (ces personnes reçoivent les cartes de rappel après leurs avaloirs).

## Communication sur les réseaux

- Lien à diffuser : `https://villecorbas.github.io/corbas-avaloirs/?rues` (après l'accueil, l'écran « Mes rues à relever » s'ouvre).
- Pour savoir où en est la campagne : les chiffres sont publics (OpenStreetMap). L'onglet Défis et le classement de la commune montrent l'avancement global ; l'écran des rues, rue par rue.

## Limites assumées

- La mairie ne voit pas qui s'est engagé sur quelle rue (pas de base centralisée) et ne peut donc pas relancer les personnes par e-mail. Les rappels se font via les réseaux sociaux et le lien ci-dessus.
- Si une relance individuelle devenait utile, il faudrait un formulaire de consentement (avec notice RGPD, durée de conservation et droits) : cette étape a été écartée volontairement.
