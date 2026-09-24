export interface UserResponse {
  email: string;
}

export function UserProfile({ user }: { user: UserResponse }) {
  return (
    <div className="user-profile">
      <span>User Email:</span>
      <p>{user.user_email}</p>
    </div>
  );
}
