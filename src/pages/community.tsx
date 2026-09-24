import { MemberResponse } from '../types/api.js';

export function RenderMemberCard({ member }: { member: MemberResponse }) {
  return (
    <div className="member-card">
      <h3>{member.name}</h3>
      <p>{member.university}</p>
    </div>
  );
}
