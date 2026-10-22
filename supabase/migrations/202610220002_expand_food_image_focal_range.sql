alter table public.food_images
  drop constraint if exists food_images_focal_x_check,
  drop constraint if exists food_images_focal_y_check;

alter table public.food_images
  add constraint food_images_focal_x_check check (focal_x between -50 and 150),
  add constraint food_images_focal_y_check check (focal_y between -50 and 150);
