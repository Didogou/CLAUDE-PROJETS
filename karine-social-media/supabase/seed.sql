-- Recettes de démarrage (rejouées à chaque `supabase db reset`)
insert into public.recipes (slug, title, category, cover_image_url, slides, tags, aliments, calories, status, published_at)
values
  (
    'tapenades', 'Les tapenades', 'entree',
    '/images/recipes/tapenades/main.png',
    array[
      '/images/recipes/tapenades/1.png','/images/recipes/tapenades/2.png','/images/recipes/tapenades/3.png',
      '/images/recipes/tapenades/4.png','/images/recipes/tapenades/5.png','/images/recipes/tapenades/6.png'
    ],
    array['apéritif','tartinade','olive','4 variantes'],
    array['olives noires','olives vertes','tomates séchées','basilic','câpres'],
    120, 'published', now()
  ),
  (
    'tomates-farcies', 'Tomates farcies', 'plat',
    '/images/recipes/tomates-farcies/main.png',
    array[
      '/images/recipes/tomates-farcies/1.png','/images/recipes/tomates-farcies/2.png','/images/recipes/tomates-farcies/3.png'
    ],
    array['farci','four','familial','4 variantes'],
    array['tomate','bœuf','thon','riz','chèvre','courgette','poulet'],
    290, 'published', now()
  ),
  (
    'brownie-healthy', 'Brownie Healthy', 'dessert',
    '/images/recipes/brownies/main.png',
    array[
      '/images/recipes/brownies/1.png','/images/recipes/brownies/2.png','/images/recipes/brownies/3.png'
    ],
    array['healthy','gourmand','sans beurre','chocolat'],
    array['compote de pommes','œufs','cacao','farine complète'],
    180, 'published', now()
  ),
  (
    'gateau-maman', 'Gâteau pour maman', 'dessert',
    '/images/recipes/gateau-maman/main.png',
    array[
      '/images/recipes/gateau-maman/1.png','/images/recipes/gateau-maman/2.png','/images/recipes/gateau-maman/3.png',
      '/images/recipes/gateau-maman/4.png','/images/recipes/gateau-maman/5.png'
    ],
    array['fête des mères','gâteau','4 variantes','sain'],
    array['fraise','citron','chocolat','noisettes','pavot','framboise','amande'],
    250, 'published', now()
  );
