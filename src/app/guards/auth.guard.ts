import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { getCurrentUser } from 'aws-amplify/auth';

export const authGuard = async () => {
  const router = inject(Router);
  try {
    await getCurrentUser();
    return true;
  } catch (err) {
    router.navigate(['/auth']);
    return false;
  }
};
