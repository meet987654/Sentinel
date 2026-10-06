/**
 * Downstream Consumer Service
 * Represents consumer code calling the User API contract.
 */
export function sendWelcomeNotification(user: any) {
  const recipientEmail = user.email;
  console.log(`Sending welcome email to ${recipientEmail}`);
  return {
    sent: true,
    email: user.email,
  };
}

export function displayUserCard(userResponse: any) {
  const { email } = userResponse;
  return `Contact: ${email}`;
}
