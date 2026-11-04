/**
 * Every user-facing text the bot sends, in Armenian. Edit wording here only.
 * Messages are sent with parse_mode HTML, so values passed in must already be escaped
 * (see src/format.ts). Poll questions and options are plain text (no HTML).
 */

export const texts = {
  help: (o: { joinMinutes: number; reminderTime: string }) =>
    [
      'Բարև 👋 Ես Zema Games բոտն եմ, օգնում եմ գրասենյակում խաղ կազմակերպել 🎲',
      '',
      '<b>Հրամաններ</b>',
      '/play · սկսել նոր խաղ',
      '/play Azul · սկսել կոնկրետ խաղով (առանց քվեարկության)',
      '/games · մեր խաղերի ցանկը',
      '/cancel · չեղարկել ընթացիկ խաղը (սկսողը կամ ադմինը)',
      '/help · այս հաղորդագրությունը',
      '',
      '<b>Ինչպես է աշխատում</b>',
      `1. /play-ից հետո ${o.joinMinutes} րոպե ունեք միանալու համար։ Եթե արդեն 2+ հոգի եք, սեղմեք «▶️ Սկսել հիմա»։`,
      '2. Ընտրում ենք խաղը՝ ըստ մարդկանց քանակի (եթե տարբերակները շատ են, քվեարկում ենք)։',
      '3. Ես կանչում եմ թիմին, և գնում եք խաղալու 🚀',
      '',
      `Աշխատանքային օրերին ${o.reminderTime}-ին կհիշեցնեմ, որ դադարի ժամն է ☕`,
    ].join('\n'),

  playOnlyInGroup: 'Խաղերը սկսվում են Zema Games խմբում 🙂 Գրիր /play այնտեղ։',
  cancelOnlyInGroup: 'Խաղը կարելի է չեղարկել միայն Zema Games խմբում։',

  // Join poll (plain text)
  joinPollQuestion: (minutes: number) => `Ո՞վ է խաղում 🎲 Միացեք ${minutes} րոպեի ընթացքում`,
  joinPollQuestionForGame: (game: string, players: string, minutes: number) =>
    `Խաղում ենք ${game} (${players} հոգի) 🎲 Ո՞վ է միանում։ Միացեք ${minutes} րոպեի ընթացքում`,
  joinOptionYes: 'Ես խաղում եմ 🙋',
  joinOptionNo: 'Այս անգամ՝ ոչ',

  startNowButton: '▶️ Սկսել հիմա',
  startNowStarted: 'Սկսում ենք 🚀',
  startNowTooFew: (min: number) => `Դեռ քիչ ենք 🙂 Պետք է առնվազն ${min} հոգի`,

  gameNotFound: (names: string) => `Այդպիսի խաղ չգտա 🤔 Ընտրիր սրանցից՝ ${names}`,
  gameAmbiguous: (names: string) => `Մի քանի խաղ է համապատասխանում՝ ${names}։ Գրիր ավելի ճշգրիտ 🙂`,
  tooFewForGame: (game: string, min: number, joined: number) =>
    `${game}-ի համար պետք է առնվազն ${min} հոգի, իսկ միացել է ${joined}-ը 😅 Խաղը չեղարկվեց, փորձեք մեկ այլ խաղ կամ /play`,
  splitIntroForGame: (game: string, players: number, max: number) =>
    `Վա՜յ, ${players} հոգի ենք 🎉 ${game}-ը մինչև ${max} հոգու համար է, բաժանվենք խմբերի՝`,
  startNowForbidden: 'Սկսել կարող են միայն միացածները 🙂',
  startNowClosed: 'Այս հարցումն արդեն փակված է',

  sessionAlreadyActive: 'Արդեն խաղ է հավաքվում 👆 Միացիր այս հարցմանը։',
  callbackSessionActive: 'Խաղն արդեն հավաքվում է 👆',
  callbackStarted: 'Սկսում ենք 🎲',

  tooFew: (min: number) => `Այս անգամ չհավաքվեցինք 😅 Պետք է առնվազն ${min} հոգի։ Հաջորդ անգամ անպայման 💪`,

  singleGame: (players: number, game: string) =>
    `${players} հոգու համար ամենահարմարը մեկ խաղ է՝ <b>${game}</b> 👌`,

  // Game poll (plain text)
  gamePollQuestion: (players: number, minutes: number) =>
    `Ի՞նչ ենք խաղում (${players} հոգի) 🗳 Քվեարկությունը՝ ${minutes} րոպե`,

  voteWinner: (game: string) => `Քվեարկությամբ հաղթեց <b>${game}</b>-ը 🎉`,
  voteTie: (tied: string, game: string) =>
    `Ձայները հավասար բաժանվեցին (${tied}), ես պատահականորեն ընտրեցի՝ <b>${game}</b> 🎲`,

  teamReady: (o: { game: string; mentions: string; link?: string }) =>
    [
      `🎮 <b>${o.game}</b>`,
      `Թիմը պատրաստ է՝ ${o.mentions}`,
      ...(o.link ? [`Հղումը՝ ${o.link}`] : []),
      'Գնացինք խաղալու 🚀',
    ].join('\n'),

  splitIntro: (players: number) =>
    `Վա՜յ, ${players} հոգի ենք 🎉 Ոչ մի խաղ այսքան մարդու համար չէ, առաջարկում եմ բաժանվել խմբերի՝`,
  splitGroup: (o: { index: number; size: number; mentions: string; games: string }) =>
    `<b>Խումբ ${o.index}</b> (${o.size} հոգի)՝ ${o.mentions}\nԽաղեր՝ ${o.games}`,
  splitOutro: 'Թիմերը պատրաստ են, գնացինք խաղալու 🚀',

  noFit: (players: number, mentions: string) =>
    `${players} հոգու համար հարմար խաղ չգտա 🤔 Նայեք /games ցանկը և ընտրեք ինքներդ՝ ${mentions}`,

  cancelled: (by: string) => `Խաղը չեղարկվեց ❌ Չեղարկեց՝ ${by}`,
  noActiveSession: 'Հիմա ակտիվ խաղ չկա։ Սկսիր /play-ով 🎲',
  cancelNotAllowed: 'Չեղարկել կարող է միայն խաղը սկսողը կամ ադմինը 🙂',

  gamesHeader: '🎲 <b>Մեր խաղերը</b>',
  gameLine: (o: { name: string; kind: string; players: string; minutes: number; description: string; link?: string }) =>
    [
      `• <b>${o.name}</b> (${o.kind}) · ${o.players} հոգի · ~${o.minutes} րոպե`,
      `  ${o.description}`,
      ...(o.link ? [`  ${o.link}`] : []),
    ].join('\n'),
  gameKind: { physical: 'սեղանի', online: 'օնլայն' } as const,

  reminders: [
    '☕ Լանչը վերջացավ, ժամանակն է մի քիչ շունչ քաշել։ Ո՞վ է խաղում',
    '🧩 Կոդը չի փախչի, իսկ լավ խաղը սպասում է։ Մի կարճ խաղ անե՞նք',
    '😺 Exploding Kittens-ը կարոտել է ձեզ։ 15 րոպե խաղ, ու նոր ուժերով առաջ',
    '🚀 Փոքր դադար, մեծ էներգիա։ Եկեք մի խաղ անենք',
    '🎯 Դադարի ժամն է՝ մի քիչ հանգստանանք ու մրցենք։ Ո՞վ է պատրաստ',
    '🎲 Ուղեղին էլ է հանգիստ պետք։ Հավաքվում ենք խաղալու',
  ],
  reminderButton: '🎲 Սկսել խաղը',

  commands: {
    play: 'Սկսել նոր խաղ',
    games: 'Խաղերի ցանկը',
    cancel: 'Չեղարկել ընթացիկ խաղը',
    help: 'Ինչպես օգտվել բոտից',
  },
} as const;
