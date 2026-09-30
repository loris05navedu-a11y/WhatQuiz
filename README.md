# WhatQuiz

**WhatQuiz** est une plateforme de quiz interactifs en temps réel pour la classe.
Le professeur crée ses quiz, les teste, puis les anime en direct : les élèves rejoignent la partie
avec un code à 6 chiffres depuis n'importe quelle tablette ou téléphone, sans créer de compte.

Le projet est pensé pour être **installé, lancé et développé depuis une tablette Android avec Termux** :
aucune dépendance native à compiler, une seule commande pour démarrer, un seul port à ouvrir.

Il peut aussi être publié **sans serveur** sur GitHub Pages : la partie tourne alors dans le navigateur du
professeur et les élèves s'y connectent en pair-à-pair (voir [Publier le site sur GitHub Pages](#publier-le-site-sur-github-pages)).

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Installation sur Android (Termux)](#installation-sur-android-termux)
3. [Installation sur un ordinateur](#installation-sur-un-ordinateur)
4. [Commandes](#commandes)
5. [Utilisation en classe](#utilisation-en-classe)
6. [Variables d'environnement](#variables-denvironnement)
7. [Architecture technique](#architecture-technique)
8. [Structure du projet](#structure-du-projet)
9. [Base de données](#base-de-données)
10. [Fonctionnement du système live](#fonctionnement-du-système-live)
11. [API REST](#api-rest)
12. [Sécurité](#sécurité)
13. [PWA (application installable)](#pwa-application-installable)
14. [Application Android (APK)](#application-android-apk)
15. [Publier le site sur GitHub Pages](#publier-le-site-sur-github-pages)
16. [Tests](#tests)
17. [Déploiement](#déploiement)
18. [Dépannage](#dépannage)

---

## Fonctionnalités

**Professeur**
- Compte sécurisé (inscription, connexion, profil, mot de passe, suppression du compte).
- Tableau de bord : statistiques, parties en cours, parties récentes, recherche/filtre/tri des quiz.
- Éditeur de quiz tactile : 4 types de questions (QCM une réponse, QCM plusieurs réponses, Vrai/Faux,
  réponse texte), images (galerie ou appareil photo, redimensionnées automatiquement), temps limite
  (5 s → 2 min), points (500 / 1000 / 2000 ou désactivés), ajout, duplication, suppression,
  réorganisation et aperçu des questions, vérification en direct des erreurs.
- **Import rapide depuis un texte** : collez vos questions dans l'éditeur (format ci-dessous), elles
  sont converties automatiquement en QCM, Vrai/Faux ou réponse libre.
- **Export / import de quiz** en fichier `.whatquiz.json` (images incluses) pour partager un quiz
  avec un collègue ou le transférer vers un autre serveur.
- Tests sans impact sur les statistiques :
  - **mode professeur** : l'écran de pilotage réel, avec des élèves fictifs qui répondent tout seuls ;
  - **mode élève** : l'expérience élève complète, la partie avance automatiquement.
- Parties en direct : salle d'attente avec code + QR code, verrouillage des inscriptions, exclusion
  de joueurs, démarrage/pause/reprise, fin de question anticipée, question précédente, correction
  et classement affichables ou masquables, avance automatique, fin de partie.
- Résultats : podium, classement, score, taux de réussite, nombre de réponses, temps moyen,
  question la plus difficile / la plus facile, réussite par question, export CSV, historique.

**Élève**
- Rejoindre avec un code (ou en scannant le QR code) et un pseudo : rien d'autre.
- Écran épuré : question, grandes tuiles de réponse, minuteur, « Réponse enregistrée », correction,
  classement et résultats finaux uniquement quand le professeur les autorise.
- Reconnexion automatique après une coupure réseau ou un rechargement de page.
- **Réactions en direct** (👍 👏 😂 😮 🤔 🔥) qui s'envolent sur l'écran du professeur
  (hors temps de réponse, limitées pour éviter le spam, masquables par le professeur).
- Compte élève facultatif pour retrouver l'historique de ses parties.

**Format de l'import texte** — un bloc par question, séparés par une ligne vide :

```text
Quelle est la capitale de l'Italie ?
* Rome
- Milan

Quels nombres sont pairs ? (30s)
* 4
- 7
* 10

La Lune est une planète.
= Faux

Combien font 7 × 8 ?
= 56 | cinquante-six
```

`*` bonne réponse, `-` mauvaise réponse, `= Vrai` / `= Faux` pour un Vrai/Faux, `= réponse` pour une
réponse libre (variantes séparées par `|`), durée facultative en fin d'énoncé : `(30s)`.

**Général** : mode clair/sombre, responsive portrait/paysage, cibles tactiles ≥ 48 px,
navigation clavier, notifications, confirmations avant suppression, mode démo sans inscription,
application installable (PWA).

---

## Installation sur Android (Termux)

> Termux doit être installé depuis **F-Droid** ou **GitHub** (la version du Play Store n'est plus à jour).

### 1. Préparer Termux

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git
node -v        # doit afficher v22.13 ou plus récent (v24 convient aussi)
```

> Si `nodejs-lts` est trop ancien, installez `pkg install nodejs` (version courante).
> WhatQuiz utilise le module SQLite **intégré à Node.js** (`node:sqlite`, Node ≥ 22.13) :
> aucune compilation (python, make, clang…) n'est nécessaire.

### 2. Récupérer et installer le projet

```bash
git clone https://github.com/loris05navedu-a11y/WhatQuiz.git
cd WhatQuiz
cp .env.example .env      # facultatif : valeurs par défaut sinon
npm install
```

### 3. Lancer WhatQuiz

```bash
npm run dev
```

Le terminal affiche :

```
  WhatQuiz démarré en mode développement

  ➜ Sur cet appareil :   http://localhost:3000
  ➜ Pour les élèves :    http://192.168.1.20:3000
```

### 4. Ouvrir l'application

- **Sur la tablette** : ouvrez Chrome (ou tout navigateur Android) à l'adresse `http://localhost:3000`.
- **Pour les élèves** (même réseau Wi-Fi) : `http://ADRESSE-IP-DE-LA-TABLETTE:3000`.
  Cette adresse est aussi affichée, avec un QR code, dans la salle d'attente de chaque partie.

Pour trouver l'adresse IP de la tablette si elle n'est pas affichée :
*Paramètres Android → Wi-Fi → (réseau connecté) → Adresse IP*, ou dans Termux :

```bash
ip -4 addr show wlan0
```

Vous pouvez alors la fixer dans `.env` : `PUBLIC_URL=http://192.168.1.20:3000`.

### 5. Conseils Termux

- `termux-wake-lock` empêche Android de mettre Termux en veille pendant une partie
  (`termux-wake-unlock` pour annuler).
- Pas de Wi-Fi dans la salle ? Activez le **point d'accès mobile** de la tablette : les élèves s'y
  connectent, puis ouvrent l'adresse affichée (souvent `http://192.168.43.1:3000`).
- Pour une utilisation en classe, préférez le mode production (plus rapide, plus léger) :
  `npm run build` une fois, puis `npm start`.
- `Ctrl + C` arrête le serveur.

---

## Installation sur un ordinateur

Prérequis : **Node.js ≥ 22.13** (Linux, macOS ou Windows).

```bash
git clone https://github.com/loris05navedu-a11y/WhatQuiz.git
cd WhatQuiz
npm install
npm run dev
```

Puis ouvrez `http://localhost:3000`.

---

## Commandes

| Commande            | Rôle                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| `npm install`       | Installe les dépendances.                                                             |
| `npm run dev`       | Développement : serveur + frontend (Vite intégré) sur **un seul port**, rechargement automatique. |
| `npm run build`     | Compile le frontend (`dist/client`) et le serveur (`dist/server`).                     |
| `npm start`         | Lance la version compilée (production).                                               |
| `npm test`          | Lance les tests automatisés (runner intégré à Node, aucune dépendance de test).        |
| `npm run typecheck` | Vérifie les types TypeScript de tout le projet.                                       |
| `npm run seed`      | Crée le compte `prof@whatquiz.local` / `whatquiz` avec le quiz de démonstration.       |

> `npm start` sert le frontend compilé : lancez `npm run build` au moins une fois avant.

---

## Utilisation en classe

1. **Découvrir** : sur l'accueil, « Essayer la démo » crée un compte professeur temporaire (24 h) avec un
   quiz prêt à jouer. Sinon, créez un compte (ou `npm run seed`).
2. **Créer** : Tableau de bord → « Créer un quiz ». Le panneau de gauche liste les questions
   (bande horizontale en mode portrait) ; un triangle signale une question incomplète.
3. **Tester** : bouton « Tester » → *Mode professeur* (avec élèves fictifs) ou *Mode élève*.
   Rien n'est enregistré dans les statistiques.
4. **Lancer** : « Lancer » → choix du score (bonus rapidité, points fixes, sans score) et des options →
   la salle d'attente affiche le code, l'adresse et un QR code.
5. **Animer** : la barre de contrôle en bas de l'écran propose toujours l'action suivante
   (Démarrer → Lancer la question → Terminer la question → Question suivante…).
   Raccourci : **Espace/Entrée** déclenche l'action principale (pratique avec un clavier Bluetooth).
6. **Analyser** : fin de partie → « Statistiques », ou plus tard via « Historique ».

---

## Variables d'environnement

Copiez `.env.example` en `.env` (jamais commité : il est dans `.gitignore`). Toutes les variables sont facultatives.

| Variable        | Défaut                 | Description                                                              |
| --------------- | ---------------------- | ------------------------------------------------------------------------ |
| `PORT`          | `3000`                 | Port HTTP (API, application et temps réel).                              |
| `HOST`          | `0.0.0.0`              | Adresse d'écoute. `0.0.0.0` rend le serveur accessible aux élèves.        |
| `DATABASE_PATH` | `./data/whatquiz.db`   | Fichier SQLite (créé automatiquement).                                   |
| `UPLOAD_DIR`    | `./data/uploads`       | Dossier des images des quiz.                                             |
| `SESSION_DAYS`  | `14`                   | Durée de validité d'une connexion.                                       |
| `COOKIE_SECURE` | `false`                | `true` uniquement derrière HTTPS.                                        |
| `MAX_PLAYERS`   | `100`                  | Nombre maximum de joueurs par partie (valeur par défaut, 200 max).       |
| `ADMIN_EMAILS`  | *(vide)*               | E-mails administrateurs (séparés par des virgules) : accès à `/admin` pour supprimer des comptes. |
| `PUBLIC_URL`    | *(détection auto)*     | Adresse montrée aux élèves dans la salle d'attente et le QR code.        |
| `CORS_ORIGINS`  | *(vide)*               | Domaines autorisés à appeler l'API (site sur GitHub Pages). Voir [Publier le site sur GitHub Pages](#publier-le-site-sur-github-pages). |
| `TRUST_PROXY`   | `loopback`             | Proxys de confiance devant le serveur (`1` derrière un hébergeur).       |
| `NODE_ENV`      | —                      | `production` est défini automatiquement par `npm start`.                 |

Aucun secret n'est nécessaire : les sessions reposent sur des jetons aléatoires stockés (hachés) en base.

---

## Architecture technique

| Couche          | Choix                                                    | Pourquoi                                                                 |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Frontend        | React 19 + TypeScript + Vite, CSS moderne (variables)    | Standard, rapide ; JSX compilé par l'esbuild de Vite (pas de Babel).      |
| Routage         | React Router (pages chargées à la demande)               | L'élève ne télécharge jamais le code de l'éditeur.                        |
| Backend         | Node.js + Express 5 + TypeScript (exécuté par `tsx`)     | Léger, connu, erreurs asynchrones gérées nativement.                     |
| Temps réel      | Socket.IO (WebSocket uniquement)                         | Reconnexion automatique, acquittements, salles.                          |
| Base de données | SQLite via `node:sqlite` (intégré à Node)                | **Zéro dépendance native** : fonctionne tel quel sur Termux.             |
| Validation      | Zod (messages en français)                               | Toutes les entrées sont validées côté serveur.                           |
| Mots de passe   | `scrypt` (module `crypto` de Node)                       | Robuste, sans module natif à compiler.                                   |
| Tests           | `node:test` + `tsx`                                      | Aucun framework de test à installer.                                     |

En **développement**, Vite est branché dans Express en mode *middleware* : un seul processus, un seul
port, une seule URL à partager avec les élèves, et Socket.IO cohabite avec le rechargement à chaud.
En **production**, le frontend est compilé en fichiers statiques servis par Express et le serveur est
compilé en un seul fichier JavaScript par esbuild.

Dépendances d'exécution : `express`, `socket.io`, `zod`. C'est tout.

---

## Structure du projet

```
WhatQuiz/
├── shared/                   Code partagé client ⇄ serveur
│   ├── types.ts              Types du domaine, vues de jeu, événements Socket.IO
│   ├── constants.ts          Limites, temps, messages d'erreur, paramètres par défaut
│   ├── scoring.ts            Correction des réponses et calcul des points
│   └── quizRules.ts          Règles de validité d'une question (éditeur + serveur)
├── server/
│   ├── src/
│   │   ├── index.ts          Point d'entrée : Vite (dev) ou fichiers compilés (prod)
│   │   ├── app.ts            Assemblage Express + Socket.IO + base de données
│   │   ├── config.ts         Lecture de .env
│   │   ├── services.ts       Conteneur des dépôts (repositories)
│   │   ├── validation.ts     Schémas Zod de toutes les entrées
│   │   ├── auth/password.ts  Hachage scrypt
│   │   ├── db/               SQLite : schéma/migrations, dépôts users, sessions, quizzes, games
│   │   ├── http/             Authentification, erreurs, limitation de débit, en-têtes de sécurité
│   │   ├── routes/           Routes REST : auth, account, quizzes, games, uploads, meta
│   │   ├── game/             Moteur de partie : GameRoom (machine à états), GameManager, bots, classement
│   │   ├── socket/           Événements Socket.IO (validation + autorisations)
│   │   ├── demo/             Quiz de démonstration
│   │   └── scripts/seed.ts   Données de démonstration
│   └── tests/                Tests : auth, quiz, partie en direct, minuteur, score
├── client/
│   ├── index.html
│   ├── public/               manifest, service worker, icônes
│   └── src/
│       ├── api/              Client HTTP typé
│       ├── components/       Composants réutilisables (boutons, formulaires, modale, menu, logo…)
│       ├── context/          Authentification, thème, toasts, confirmations
│       ├── editor/           Éditeur de questions, aperçu, choix d'image
│       ├── game/             Minuteur, tuiles de réponse, classement animé, hooks temps réel
│       ├── lib/              Formatage, socket, image, stockage
│       ├── pages/            Écrans de l'application
│       └── styles/           Design system (jetons, composants, pages, scène de jeu)
├── scripts/                  Compilation du serveur, génération des icônes
├── .env.example
├── vite.config.ts
└── tsconfig.json
```

---

## Base de données

Fichier SQLite unique (`data/whatquiz.db`), créé et migré automatiquement au démarrage
(table `migrations`). Clés étrangères activées, journal WAL.

| Table            | Contenu                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `users`          | Comptes (e-mail unique, hash scrypt, nom, rôle `teacher`/`student`, compte démo).       |
| `sessions`       | Sessions de connexion (seul le **hash SHA-256** du jeton est stocké, avec expiration). |
| `quizzes`        | Quiz d'un professeur (titre, description, image, catégorie).                          |
| `questions`      | Questions ordonnées (type, énoncé, image, temps, points, points actifs).              |
| `answers`        | Choix d'une question (texte, bonne réponse) ou réponses acceptées (type texte).       |
| `game_sessions`  | Parties en direct : code, hôte, statut, paramètres, **copie figée du quiz**.          |
| `players`        | Joueurs d'une partie (pseudo, score final, compte élève éventuel, exclusion).         |
| `player_answers` | Chaque réponse : contenu, justesse, points, temps de réponse (unique par question).   |
| `game_results`   | Résultat final par joueur : rang, score, bonnes réponses, temps moyen.                |

Relations : `users 1—n quizzes 1—n questions 1—n answers` ; `game_sessions 1—n players 1—n player_answers` ;
`game_sessions 1—n game_results`. Supprimer un quiz conserve l'historique de ses parties (copie figée).

Réinitialiser toutes les données : arrêtez le serveur puis supprimez le dossier `data/`.
Sauvegarder : copiez `data/` (serveur arrêté).

---

## Fonctionnement du système live

### Principe : le serveur est l'unique autorité

Chaque partie active est une instance de `GameRoom` en mémoire (identifiée par son code). Les clients
n'envoient que des **intentions** (rejoindre, répondre, action du professeur) ; le serveur valide,
applique, calcule, puis renvoie à chacun un **instantané complet** de l'état qui le concerne :

- `host:state` (`HostView`) au professeur : joueurs, question avec bonnes réponses, répartition des réponses…
- `game:state` (`PlayerView`) à chaque élève, **personnalisé** : sa réponse, son résultat, son score
  « révélé »… et **jamais** la bonne réponse avant la correction.

Ce choix (instantanés plutôt que petits événements) rend la synchronisation robuste : un élève qui se
reconnecte, recharge la page ou rate un message retrouve immédiatement l'état exact. Les envois sont
regroupés (une émission par destinataire et par cycle) et les notifications « nouvelle réponse » au
professeur sont limitées à une toutes les 150 ms.

### Déroulement (machine à états)

```
lobby ──start──▶ ready ──startQuestion──▶ question ──(temps écoulé | tous ont répondu | endQuestion)──▶ reveal
                   ▲                        │ pause / resume                                          │
                   └──────────────── next ◀──────────────────────────────────────────────────────────┘
reveal ──next (dernière question)──▶ ended          previous : retour à la correction précédente (si autorisé)
```

### Événements Socket.IO

| Sens              | Événement      | Contenu                                   | Rôle                                                           |
| ----------------- | -------------- | ----------------------------------------- | -------------------------------------------------------------- |
| élève → serveur   | `game:join`    | `{ code, nickname, token? }` + acquittement | Rejoindre (ou reprendre avec le jeton de reconnexion).         |
| élève → serveur   | `game:answer`  | `{ questionIndex, answer }` + acquittement | Répondre (refusé si temps écoulé, pause, déjà répondu…).       |
| élève → serveur   | `game:leave`   | —                                         | Quitter la partie.                                             |
| élève → serveur   | `game:react`   | `{ emoji }`                               | Réaction (liste fermée, 6 max. / 5 s par élève).               |
| prof → serveur    | `host:join`    | `{ code }` + acquittement                 | Prendre le contrôle (vérifie que la partie lui appartient).    |
| prof → serveur    | `host:action`  | `HostAction` + acquittement               | Toutes les commandes (voir ci-dessous).                        |
| serveur → élève   | `game:state`   | `PlayerView`                              | État personnalisé de la partie.                                |
| serveur → prof    | `host:state`   | `HostView`                                | État complet de la partie.                                     |
| serveur → élève   | `game:kicked`  | —                                         | L'élève a été exclu.                                           |
| serveur → prof    | `host:reaction`| `{ emoji, nickname }`                     | Réaction d'un élève à afficher.                                |

Actions du professeur (`host:action`) et correspondance avec le cycle de jeu :

| Action                  | Équivalent                  | Effet                                                    |
| ----------------------- | --------------------------- | -------------------------------------------------------- |
| `start`                 | `game:start`                | Quitte la salle d'attente, affiche la 1ʳᵉ question.      |
| `startQuestion`         | `game:questionStart`        | Ouvre les réponses et démarre le minuteur serveur.       |
| `pause` / `resume`      | `game:paused` / `game:resumed` | Gèle / relance le minuteur (réponses bloquées en pause). |
| `endQuestion`           | `game:questionEnd`          | Clôt la question, calcule les scores.                    |
| `next` / `previous`     | `game:nextQuestion`         | Question suivante / correction précédente.               |
| `setAnswersVisible`     | —                           | Affiche ou masque la correction chez les élèves.         |
| `setLeaderboardVisible` | `game:leaderboard`          | Affiche ou masque le classement.                         |
| `setResultsVisible`     | —                           | Affiche ou masque les résultats finaux chez les élèves.  |
| `setLocked`             | —                           | Verrouille / ouvre les inscriptions.                     |
| `kick`                  | `game:playerLeft`           | Exclut un joueur (il ne peut plus revenir).              |
| `updateSettings`        | —                           | Modifie les options de la partie.                        |
| `addBots`               | —                           | Ajoute des élèves fictifs (tests et comptes démo uniquement). |
| `end`                   | `game:end`                  | Termine la partie et enregistre les résultats.           |

### Minuteur

Le serveur fixe l'heure de fin (`endsAt`) et déclenche lui-même la fin de question. Chaque état
envoie aussi l'heure serveur (`serverNow`) : le client en déduit le décalage de son horloge et affiche
un compte à rebours identique sur tous les appareils. Une réponse qui arrive après `endsAt`, pendant une
pause ou hors question est refusée. Le temps de pause n'est pas compté dans le temps de réponse.

### Score

Calculé uniquement par le serveur (`shared/scoring.ts`) :

- **Points fixes** : bonne réponse = points de la question (1000 par défaut).
- **Bonus rapidité** : `points × (1 − (temps de réponse / temps limite) / 2)`, soit de 100 % (réponse
  immédiate) à 50 % (dernière seconde).
- **Sans score** : aucun point, aucun classement.
- QCM à plusieurs réponses : toutes les bonnes réponses et aucune mauvaise.
- Réponse texte : comparaison insensible à la casse, aux accents, aux espaces et à la ponctuation finale.

Le score affiché à l'élève ne change qu'au moment où la correction ou le classement sont affichés, pour
ne pas dévoiler la bonne réponse trop tôt.

### Parties de test et démo

Les parties de test (`test-host`, `test-player`) utilisent exactement le même moteur mais ne sont
**jamais écrites en base**. Le mode élève active l'avance automatique et démarre dès l'arrivée du
joueur. Les élèves fictifs répondent avec un délai et une justesse aléatoires (≈ 70 %).

Les parties vivent en mémoire : si le serveur redémarre, les parties en cours sont marquées « annulées ».
Une partie terminée reste consultable 30 minutes par les élèves, ses résultats restent en base.

---

## API REST

Toutes les routes sont préfixées par `/api` et répondent en JSON (`{ error: "message lisible" }` en cas d'erreur).

| Méthode | Route                       | Accès      | Rôle                                            |
| ------- | --------------------------- | ---------- | ----------------------------------------------- |
| POST    | `/auth/register`            | public     | Créer un compte (professeur ou élève).          |
| POST    | `/auth/login`               | public     | Se connecter.                                   |
| POST    | `/auth/logout`              | connecté   | Se déconnecter.                                 |
| GET     | `/auth/me`                  | public     | Utilisateur courant (`null` si déconnecté).     |
| POST    | `/auth/demo`                | public     | Créer un compte démo temporaire.                |
| PUT     | `/account/profile`          | connecté   | Modifier nom et e-mail.                         |
| PUT     | `/account/password`         | connecté   | Changer le mot de passe.                        |
| DELETE  | `/account`                  | connecté   | Supprimer le compte.                            |
| GET     | `/account/history`          | connecté   | Historique des parties d'un élève.              |
| GET     | `/quizzes`                  | professeur | Liste des quiz.                                 |
| POST    | `/quizzes`                  | professeur | Créer un quiz (avec ses questions).             |
| POST    | `/quizzes/demo`             | professeur | Ajouter le quiz de démonstration.               |
| GET     | `/quizzes/:id`              | propriétaire | Détail d'un quiz.                             |
| PUT     | `/quizzes/:id`              | propriétaire | Remplacer un quiz.                            |
| DELETE  | `/quizzes/:id`              | propriétaire | Supprimer un quiz.                            |
| POST    | `/quizzes/:id/duplicate`    | propriétaire | Dupliquer un quiz.                            |
| POST    | `/games`                    | professeur | Créer une partie (`mode`: `live`, `test-host`, `test-player`). |
| GET     | `/games`                    | professeur | Historique + parties en cours.                  |
| GET     | `/games/stats`              | professeur | Statistiques du tableau de bord.                |
| GET     | `/games/code/:code`         | public     | Vérifier un code avant de rejoindre.            |
| GET     | `/games/:id`                | propriétaire | État en direct ou résultats.                  |
| GET     | `/games/:id/results`        | propriétaire | Résultats détaillés.                          |
| POST    | `/games/:id/start`          | propriétaire | Démarrer la partie.                           |
| POST    | `/games/:id/next`           | propriétaire | Étape suivante (lancer / clore / question suivante). |
| POST    | `/games/:id/end`            | propriétaire | Terminer la partie.                           |
| DELETE  | `/games/:id`                | propriétaire | Supprimer une partie de l'historique.         |
| POST    | `/uploads`                  | professeur | Envoyer une image (PNG, JPEG, GIF, WebP, 2 Mo). |
| GET     | `/admin/users`              | admin      | Lister tous les comptes.                        |
| DELETE  | `/admin/users/:id`          | admin      | Supprimer un compte (quiz et parties inclus).   |
| GET     | `/meta`                     | public     | Adresse(s) à communiquer aux élèves.            |

---

## Administration

Pour supprimer des comptes (par exemple pour réutiliser une adresse e-mail lors de tests) :

1. Créez d'abord le compte qui sera administrateur via l'inscription.
2. Dans `.env`, ajoutez son adresse : `ADMIN_EMAILS=moi@exemple.fr` (plusieurs adresses possibles, séparées par des virgules), puis relancez le serveur.
3. Connecté avec ce compte, ouvrez le menu du compte → **Administration** (ou `/admin`) : recherche, puis icône corbeille avec confirmation.

La suppression efface le compte, ses quiz et l'historique de ses parties ; l'adresse e-mail redevient libre. Les comptes administrateurs et votre propre compte ne peuvent pas être supprimés depuis ce panneau.

## Sécurité

- Mots de passe hachés avec **scrypt** et sel unique ; comparaison à temps constant ; jamais stockés en clair.
- Sessions : jeton aléatoire de 256 bits dans un cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` en HTTPS) ;
  seul son hash est en base ; expiration ; changement de mot de passe = déconnexion des autres sessions.
- Protection CSRF : cookie `SameSite` et obligation d'envoyer du JSON pour toute requête avec un corps.
- Limitation des tentatives de connexion / inscription et des tentatives de code de partie.
- Validation **serveur** de toutes les entrées (Zod) : REST **et** Socket.IO.
- Autorisations : chaque quiz, partie et résultat est vérifié par propriétaire ; les comptes élèves
  n'ont aucun accès aux routes professeur ; seul le créateur d'une partie peut la piloter.
- Scores, justesse, minuteur et classement calculés exclusivement par le serveur ; la bonne réponse
  n'est jamais envoyée aux élèves avant la correction ; réponses refusées après la fin du temps.
- Images : type réel vérifié par signature binaire (pas de SVG), taille limitée, nom aléatoire.
- En-têtes : `Content-Security-Policy` (production), `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`.
- Messages d'erreur toujours lisibles et génériques : aucune trace technique n'est montrée à l'utilisateur.

---

## PWA (application installable)

- `manifest.webmanifest` (nom, couleurs, icônes standard et *maskable*, raccourcis) ;
- icônes PNG 192/512, icône Apple, favicon SVG ; l'écran de démarrage Android est généré à partir du manifest ;
- service worker (production uniquement) : l'interface se charge même avec un réseau instable ;
  l'API et le temps réel ne sont jamais mis en cache.

Installation : ouvrez WhatQuiz dans Chrome → menu ⋮ → **Installer l'application** / **Ajouter à l'écran d'accueil**.

> Chrome n'autorise l'installation (et le service worker) que sur `localhost` ou en **HTTPS**.
> Sur la tablette qui héberge le serveur, `http://localhost:3000` suffit. Pour les appareils des élèves,
> l'application fonctionne parfaitement dans le navigateur ; l'installation nécessite un déploiement HTTPS.

Les icônes peuvent être régénérées depuis `client/public/icons/icon.svg` avec
`node scripts/generate-icons.mjs` (nécessite Playwright, outil facultatif non installé par défaut).

---

## Application Android (APK)

Le dossier `android/` contient une application Android native très légère (≈ 25 Ko, sans dépendance)
qui affiche le site WhatQuiz publié sur **GitHub Pages** en plein écran. Aucune adresse à saisir : l'app
s'ouvre directement sur le site.

- L'adresse du site est dans `android/app/src/main/res/values/strings.xml` (`app_url`,
  par défaut `https://loris05navedu-a11y.github.io/WhatQuiz/`) : modifiez-la puis recompilez si le compte
  ou le dépôt change.
- Sans connexion Internet, un écran « Connexion impossible » propose de réessayer.
- Les exports (CSV des résultats, fichiers de quiz) sont enregistrés dans **Téléchargements/WhatQuiz**.
- Le choix d'images (galerie/appareil photo) et l'import de fichiers passent par le sélecteur Android.
- Les nouveautés du site arrivent sans réinstaller l'APK : il suffit de redéployer GitHub Pages.
- Seul le trafic HTTPS est autorisé.

Installer l'APK : copiez `WhatQuiz.apk` sur le téléphone, ouvrez-le et autorisez l'installation
depuis cette source (Android le demande une fois).

Compiler l'APK (JDK 17+ et Android SDK) :

```bash
cd android
echo "sdk.dir=/chemin/vers/android-sdk" > local.properties
./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk
```

Pour une version signée, créez `android/keystore.properties` (non versionné) :
`storeFile=…jks`, `storePassword=…`, `keyAlias=…`, `keyPassword=…`. Sans ce fichier, utilisez
`./gradlew assembleDebug`. Une mise à jour de l'APK doit être signée avec la même clé ; sinon
désinstallez l'ancienne version avant d'installer la nouvelle.

---

## Publier le site sur GitHub Pages

Le site peut être publié **gratuitement et sans aucun serveur** sur GitHub Pages :
`https://loris05navedu-a11y.github.io/WhatQuiz/` (c'est aussi l'adresse ouverte par l'APK).

### Mise en ligne

1. Dépôt GitHub → **Settings → Pages → Source : GitHub Actions**.
2. Poussez sur `main` (ou *Actions → Déployer le site sur GitHub Pages → Run workflow*).

Le workflow `.github/workflows/pages.yml` compile le site avec `BASE_PATH=/<nom-du-dépôt>/`, crée `404.html`
pour les liens profonds (`/join`, `/dashboard`…) et le publie.

### Fonctionnement sans serveur

```
Élève (téléphone)  ◄── WebRTC, en direct ──►  Professeur (onglet de la partie)
          └──── mise en relation : serveur public PeerJS ────┘
```

- **Comptes et quiz** sont enregistrés dans le navigateur (IndexedDB) de l'appareil où ils ont été créés.
  Pour passer un quiz sur un autre appareil : *Exporter* puis *Importer* (fichier `.whatquiz.json`).
- **La partie tourne dans l'onglet du professeur** : c'est lui qui fait autorité (minuteur, score, bonnes
  réponses, qui ne quittent jamais son appareil). **Gardez cette page ouverte** pendant la partie :
  la fermer ou la recharger met fin à la partie. L'écran reste allumé automatiquement quand le navigateur le permet.
- **Les élèves se connectent en pair-à-pair** (WebRTC, bibliothèque PeerJS). Le service public gratuit de PeerJS
  ne sert qu'à la mise en relation ; les réponses passent directement d'appareil à appareil. Une connexion
  Internet est nécessaire au lancement de la partie et à l'arrivée de chaque élève.
- Un élève qui perd le réseau ou recharge sa page reprend la partie là où il en était.
- Les images sont intégrées au quiz (réduites à 800 px) au lieu d'être envoyées sur un serveur.
- Un élève connecté à un compte élève sur son appareil retrouve ses parties dans « Mon espace ».
- Le panneau d'administration n'existe pas dans ce mode (chaque appareil ne contient que ses propres comptes).
- **Comptes Furious-Tube acceptés, sans inscription** : WhatQuiz utilise le projet Firebase de
  [Furious-Tube](https://loris05navedu-a11y.github.io/Furious-Tube/), à la même adresse de site, donc la même session.
  - Déjà connecté sur Furious-Tube dans ce navigateur → « Compte Furious-Tube détecté : Continuer en tant que … »
    (accueil et page de connexion), un clic suffit.
  - Sinon, l'e-mail et le mot de passe Furious-Tube fonctionnent dans le formulaire de connexion de WhatQuiz.
  - « Continuer avec Google » fonctionne aussi (fournisseur Google à activer dans la console Firebase). Google interdit
    cette connexion dans les WebView : ce bouton n'est pas proposé dans l'APK Android.

  Firebase vérifie l'identité ; WhatQuiz ouvre ensuite le compte de cet appareil, créé au besoin. Il n'est relié à un
  compte WhatQuiz existant de même adresse que si Firebase a vérifié cette adresse. Les quiz restent sur l'appareil.
  Se déconnecter de WhatQuiz ne ferme pas la session Furious-Tube. Code : `client/src/lib/firebaseAccount.ts`.

Compilation manuelle équivalente :

```bash
BASE_PATH=/WhatQuiz/ VITE_STANDALONE=true npm run build:client
cp dist/client/index.html dist/client/404.html
```

Code : `client/src/standalone/` (`db.ts` données du navigateur, `api.ts` mêmes routes que le serveur,
`hub.ts` moteur de partie de `server/src/game` exécuté dans le navigateur, `peer.ts` liaison WebRTC,
`socket.ts` remplaçant de Socket.IO pour les écrans de jeu). Test : `server/tests/standalone.test.ts`.

### Variante : relier le site à un serveur WhatQuiz (facultatif)

Pour des comptes partagés entre appareils, faites tourner le serveur sur un hébergeur Node.js ≥ 22.13
**avec disque persistant** (`npm ci && npm run build && npm start`), puis créez la variable de dépôt
**Settings → Secrets and variables → Actions → Variables → `API_URL`** = adresse HTTPS du serveur (sans `/` final).
Le workflow compile alors le site avec `VITE_API_URL` au lieu du mode sans serveur.

| Variable du serveur | Exemple | Rôle |
| ------------------- | ------- | ---- |
| `CORS_ORIGINS` | `https://loris05navedu-a11y.github.io` | Domaine du site GitHub Pages (sans chemin). |
| `TRUST_PROXY` | `1` | Nombre de proxys devant le serveur (1 sur Render/Fly/Railway). |
| `DATABASE_PATH`, `UPLOAD_DIR` | `/data/whatquiz.db`, `/data/uploads` | Sur le disque persistant, sinon tout est perdu au redémarrage. |

Dans cette variante, la connexion utilise un jeton (en-tête `Authorization`) au lieu d'un cookie, et les images
restent stockées sur le serveur. Les offres gratuites sans disque persistant (Render gratuit, par exemple)
ne conviennent pas : supprimez simplement `API_URL` pour revenir au mode sans serveur.

---

## Tests

```bash
npm test
```

33 tests couvrent : création de compte, connexion/déconnexion, permissions élève/professeur,
protection CSRF, compte démo, création/validation/modification/duplication/suppression de quiz,
création de partie, rejoindre (code incorrect, pseudo déjà utilisé, inscriptions verrouillées,
exclusion), confidentialité des bonnes réponses, réponse unique, fin automatique de question,
calcul des scores (points fixes et bonus rapidité), minuteur serveur (fin de temps, pause, réponse
tardive), classement, fin de partie et enregistrement des résultats, parties de test non enregistrées.

---

## Déploiement

### Sur la tablette (usage en classe)

```bash
npm run build
npm start
```

### Sur un serveur (VPS, Raspberry Pi…)

```bash
git clone https://github.com/loris05navedu-a11y/WhatQuiz.git && cd WhatQuiz
npm install
npm run build
cp .env.example .env    # adaptez PORT, et COOKIE_SECURE=true derrière HTTPS
npm start
```

Pour garder le service actif, utilisez `systemd` ou `pm2` (`pm2 start npm --name whatquiz -- start`).

Derrière un proxy inverse (HTTPS), les WebSockets doivent être transmis. Exemple **nginx** :

```nginx
server {
  server_name quiz.mon-ecole.fr;
  client_max_body_size 4m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

Les parties étant conservées en mémoire, WhatQuiz s'exécute en **une seule instance** (largement
suffisant pour plusieurs classes simultanées). Sauvegardez régulièrement le dossier `data/`.

---

## Dépannage

| Problème | Solution |
| -------- | -------- |
| `No such built-in module: node:sqlite` | Node.js est trop ancien : il faut **≥ 22.13** (`pkg install nodejs` sur Termux). |
| Les élèves n'arrivent pas à se connecter | Même réseau Wi-Fi ? Utilisez l'adresse IP de la tablette (pas `localhost`), vérifiez `HOST=0.0.0.0`. Certains réseaux d'établissement isolent les appareils : utilisez alors le point d'accès de la tablette. |
| L'adresse pour les élèves n'est pas affichée (Termux) | Android peut bloquer la lecture des interfaces réseau : définissez `PUBLIC_URL` dans `.env`. |
| `EADDRINUSE` | Le port est occupé : changez `PORT` dans `.env`. |
| `npm start` indique « Frontend introuvable » | Lancez `npm run build` avant. |
| La partie s'arrête quand l'écran de la tablette s'éteint | `termux-wake-lock`, et désactivez l'optimisation de batterie pour Termux. |
